import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConversationStatus, MessageRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LLM_PORT } from '../src/modules/agent';
import { MESSAGING_PORT } from '../src/modules/messaging';
import { PrismaService } from '../src/shared/database/prisma.service';
import { ScriptedLlmPort } from './agent/support/scripted-llm-port';
import { FakeMessagingPort } from './support/fake-messaging-port';
import { uniquePhone } from './support/unique-phone';
import { waitFor } from './support/wait-for';
import { waitForQueueWorkersReady } from './support/wait-for-queues-ready';
import { buildWhatsappTextPayload, signPayload } from './support/whatsapp-payload';

const APP_SECRET = 'test-app-secret-output-guardrail';
const DEBOUNCE_MS = 50;

/**
 * Contraste deliberado com test/llm-transient-failure-preserves-messages.e2e-spec.ts:
 * llm_error (falha de INFRAESTRUTURA) nao marca consumido nem escala.
 * RN-03 (falha de COMPORTAMENTO — resposta com dado nao confirmado por
 * tool, rejeitada duas vezes) e uma decisao definitiva do sistema — fecha
 * o turno normalmente: marca consumido e escala pra humano com
 * HandoffTicket, exatamente como guardrail de entrada e max_iterations.
 * Ver pergunta 2 do plano da Fase 5.
 */
describe('Guardrail de saida (RN-03): rejeicao dupla fecha o turno e escala normalmente', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fakeMessagingPort: FakeMessagingPort;
  let scriptedLlmPort: ScriptedLlmPort;

  beforeAll(async () => {
    process.env.MESSAGE_DEBOUNCE_MS = String(DEBOUNCE_MS);
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;

    const { AppModule } = await import('../src/app.module');

    fakeMessagingPort = new FakeMessagingPort();
    scriptedLlmPort = new ScriptedLlmPort([
      { toolCalls: [{ id: '1', name: 'listar_procedimentos', arguments: {} }] },
      { text: 'A consulta custa R$999, um valor que eu inventei.' },
      { text: 'Continuo dizendo que custa R$999 — nao corrigi.' },
    ]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_PORT)
      .useValue(fakeMessagingPort)
      .overrideProvider(LLM_PORT)
      .useValue(scriptedLlmPort)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    prisma = moduleRef.get(PrismaService);
    await app.init();
    await waitForQueueWorkersReady(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  async function postMessage(fromPhone: string, text: string, wamid: string) {
    const { payload } = buildWhatsappTextPayload({ fromPhone, text, wamid });
    const rawBody = JSON.stringify(payload);
    const signature = signPayload(rawBody, APP_SECRET);

    return request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(rawBody);
  }

  it('marca a mensagem consumida, escala pra AWAITING_HUMAN e cria HandoffTicket com reason RN-03', async () => {
    const fromPhone = uniquePhone();
    const wamid = `wamid.OUTPUT_GUARDRAIL_TEST_${fromPhone}`;

    const response = await postMessage(fromPhone, 'quanto custa a consulta com cardiologista?', wamid);
    expect(response.status).toBe(200);

    const conversation = await waitFor(() =>
      prisma.conversation.findFirst({ where: { patient: { phoneE164: `+${fromPhone}` } } }),
    );

    const ticket = await waitFor(() =>
      prisma.handoffTicket.findFirst({ where: { conversationId: conversation.id } }),
    );
    expect(ticket.reason).toBe('RN-03');
    expect(ticket.reason).not.toBe('llm_error');
    expect(ticket.summary).toContain('999');

    // Diferente de llm_error: o turno FECHOU — mensagem consumida, conversa escalada.
    const message = await prisma.message.findFirstOrThrow({
      where: { conversationId: conversation.id, role: MessageRole.PATIENT },
    });
    expect(message.consumedAt).not.toBeNull();

    const conversationAfter = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conversationAfter.status).toBe(ConversationStatus.AWAITING_HUMAN);

    // Nunca chegou a enviar a resposta com o valor inventado ao paciente.
    expect(fakeMessagingPort.sentMessages).toHaveLength(0);
    expect(scriptedLlmPort.callCount).toBe(3);
  });
});

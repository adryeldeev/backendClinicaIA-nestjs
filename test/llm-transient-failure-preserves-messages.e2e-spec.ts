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

const APP_SECRET = 'test-app-secret-llm-transient-failure';
const DEBOUNCE_MS = 50;

/**
 * Achado no teste manual da Fase 3 (503 "high demand" persistente do
 * Gemini): quando o LlmPort falha depois de esgotar retry+fallback
 * (GeminiLlmAdapter), o turno nao pode marcar as mensagens do paciente
 * como consumidas nem escalar pra humano — e falha TRANSITORIA de
 * infraestrutura, nao uma decisao do sistema. Se marcasse consumido, a
 * mensagem do paciente sumiria pra sempre depois de um simples soluco de
 * rede. Ver HandleDebouncedMessageUseCase: reason 'llm_error' e o unico
 * desfecho de escalate que NAO fecha o turno.
 */
describe('LlmPort falha por infra (Fase 3): mensagens sobrevivem pro proximo turno', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fakeMessagingPort: FakeMessagingPort;
  let scriptedLlmPort: ScriptedLlmPort;

  beforeAll(async () => {
    process.env.MESSAGE_DEBOUNCE_MS = String(DEBOUNCE_MS);
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;

    const { AppModule } = await import('../src/app.module');

    fakeMessagingPort = new FakeMessagingPort();
    // 1a chamada: simula o LlmPort ja esgotado (retry+fallback do adapter
    // tentaram e falharam) — o que o orquestrador ve e um throw comum.
    // 2a chamada (proximo turno): o provedor voltou, responde normal.
    scriptedLlmPort = new ScriptedLlmPort([
      { throws: new Error('gemini_request_failed: HTTP 503 (simulado, apos esgotar retry+fallback)') },
      { text: 'Desculpa a demora! Vou te ajudar com isso agora.' },
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

  it('1o turno falha (LLM indisponivel): mensagem NAO e consumida, conversa NAO escala. 2o turno (nova mensagem do paciente): pega a antiga junto e fecha com sucesso', async () => {
    const fromPhone = uniquePhone();
    const wamid1 = `wamid.LLM_FAIL_TEST_1_${fromPhone}`;
    const wamid2 = `wamid.LLM_FAIL_TEST_2_${fromPhone}`;

    const firstResponse = await postMessage(fromPhone, 'Oi, quero marcar uma consulta.', wamid1);
    expect(firstResponse.status).toBe(200);

    // Espera o 1o turno rodar e falhar (a unica forma observavel e o
    // LlmPort ter sido chamado, ja que nao ha outbox nem escalada nesse
    // caminho).
    await waitFor(async () => (scriptedLlmPort.callCount >= 1 ? true : undefined));

    const conversation = await prisma.conversation.findFirstOrThrow({
      where: { patient: { phoneE164: `+${fromPhone}` } },
    });

    // A mensagem do paciente continua disponivel — NAO foi consumida por
    // uma falha transitoria do provedor.
    const messageAfterFailure = await prisma.message.findFirstOrThrow({
      where: { conversationId: conversation.id, role: MessageRole.PATIENT },
    });
    expect(messageAfterFailure.consumedAt).toBeNull();

    // A conversa NAO escalou pra humano por causa de infra — ficaria uma
    // "enxurrada na fila da recepcao" a cada soluco do Gemini.
    const conversationAfterFailure = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(conversationAfterFailure.status).toBe(ConversationStatus.BOT);

    // Nenhuma resposta foi enviada (nem deveria: o turno nao fechou).
    expect(fakeMessagingPort.sentMessages).toHaveLength(0);

    // 2o turno: uma nova mensagem do paciente reagenda o debounce e o job
    // roda de novo — encontrando a mensagem ANTIGA (nunca consumida) junto
    // com a nova.
    const secondResponse = await postMessage(fromPhone, 'Ainda esta ai?', wamid2);
    expect(secondResponse.status).toBe(200);

    await waitFor(() => prisma.outboxMessage.findFirst({ where: { toPhoneE164: `+${fromPhone}` } }));

    expect(scriptedLlmPort.callCount).toBe(2);
    // O turno que teve sucesso viu as DUAS mensagens — a que falhou antes
    // nao se perdeu.
    const [, secondTurn] = scriptedLlmPort.receivedInputs;
    const turnMessage = secondTurn.messages[secondTurn.messages.length - 1];
    expect(turnMessage.content).toContain('Oi, quero marcar uma consulta.');
    expect(turnMessage.content).toContain('Ainda esta ai?');

    const messagesAfterSuccess = await prisma.message.findMany({
      where: { conversationId: conversation.id, role: MessageRole.PATIENT },
    });
    expect(messagesAfterSuccess.every((message) => message.consumedAt !== null)).toBe(true);

    const conversationAfterSuccess = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(conversationAfterSuccess.status).toBe(ConversationStatus.BOT);
  });
});

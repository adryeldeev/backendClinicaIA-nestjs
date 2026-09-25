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

const APP_SECRET = 'test-app-secret-e2e';

async function postWebhook(app: INestApplication, rawBody: string, signature: string) {
  return request(app.getHttpServer())
    .post('/webhooks/whatsapp')
    .set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', signature)
    .send(rawBody);
}

describe('Webhook do WhatsApp — pipeline completo ate o outbox (Fase 1+3, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fakeMessagingPort: FakeMessagingPort;

  beforeAll(async () => {
    // Precisa ser definido ANTES de importar o AppModule: o decorator
    // @Module() de AppModule executa ConfigModule.forRoot() no momento em
    // que o modulo e avaliado, e imports ES sao hoisted acima de qualquer
    // atribuicao a process.env feita no topo do arquivo — por isso o
    // import e dinamico aqui, depois das duas linhas abaixo.
    process.env.MESSAGE_DEBOUNCE_MS = '200';
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;

    const { AppModule } = await import('../src/app.module');

    fakeMessagingPort = new FakeMessagingPort();

    // Desde a Fase 3 o pipeline chama o orquestrador de verdade (nao eco
    // mais) — o LlmPort tambem precisa ser fake aqui, senao o teste
    // tentaria chamar a API real do Gemini.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_PORT)
      .useValue(fakeMessagingPort)
      .overrideProvider(LLM_PORT)
      .useValue(new ScriptedLlmPort([{ text: 'Oi! Sou o assistente virtual da clinica, como posso ajudar?' }]))
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    prisma = moduleRef.get(PrismaService);
    await app.init();
    await waitForQueueWorkersReady(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  it('paciente manda "oi" e recebe a resposta do orquestrador — nao chama a API real da Meta nem do Gemini', async () => {
    const fromPhone = uniquePhone();
    const { payload } = buildWhatsappTextPayload({ fromPhone, text: 'oi' });
    const rawBody = JSON.stringify(payload);
    const signature = signPayload(rawBody, APP_SECRET);

    const response = await postWebhook(app, rawBody, signature);
    expect(response.status).toBe(200);

    const expectedReply = 'Oi! Sou o assistente virtual da clinica, como posso ajudar?';

    const sent = await waitFor(() =>
      Promise.resolve(fakeMessagingPort.sentMessages.find((m) => m.to === `+${fromPhone}`)),
    );
    expect(sent.body).toBe(expectedReply);

    // waitFor so exige "verdadeiro" — a linha do outbox existe (status
    // PENDING) antes do DispatchOutboxJob (assincrono, fila separada)
    // terminar de verdade. Espera especificamente o status terminal, nao
    // so a existencia da linha (achado da Fase 5: um await extra no
    // DispatchOutboxJob — checagem de janela de 24h — alargou essa corrida
    // pre-existente o suficiente pra aparecer).
    const outbox = await waitFor(async () => {
      const found = await prisma.outboxMessage.findFirst({ where: { toPhoneE164: `+${fromPhone}` } });
      return found?.status === 'PENDING' ? undefined : found;
    });
    expect(outbox.status).toBe('SENT');
    expect(outbox.body).toBe(expectedReply);

    // Contrato da Fase 1, divergencia #5: a Message(AGENT) so existe DEPOIS
    // do outbox (correcao 2 — outbox primeiro, id passado na criacao da
    // Message) e ja nasce ligada a ele, nunca um passo separado depois.
    const agentMessage = await prisma.message.findFirstOrThrow({
      where: { conversation: { patientId: (await prisma.patient.findUniqueOrThrow({ where: { phoneE164: `+${fromPhone}` } })).id }, role: MessageRole.AGENT },
    });
    expect(agentMessage.outboxMessageId).toBe(outbox.id);
  });

  it('assinatura invalida e rejeitada com 401 e nao grava nada no banco', async () => {
    const fromPhone = uniquePhone();
    const { payload, wamid } = buildWhatsappTextPayload({ fromPhone, text: 'mensagem forjada' });
    const rawBody = JSON.stringify(payload);

    const response = await postWebhook(app, rawBody, 'sha256=assinatura-forjada-invalida');
    expect(response.status).toBe(401);

    const inboundEvent = await prisma.inboundEvent.findUnique({ where: { externalId: wamid } });
    expect(inboundEvent).toBeNull();
  });

  it('RN-15 / criterio de aceite #12: conversa em HUMAN nao recebe resposta automatica', async () => {
    const fromPhone = uniquePhone();

    const patient = await prisma.patient.create({ data: { phoneE164: `+${fromPhone}` } });
    await prisma.conversation.create({
      data: { patientId: patient.id, status: ConversationStatus.HUMAN },
    });

    const { payload } = buildWhatsappTextPayload({ fromPhone, text: 'ainda estou aqui' });
    const rawBody = JSON.stringify(payload);
    const signature = signPayload(rawBody, APP_SECRET);

    const response = await postWebhook(app, rawBody, signature);
    expect(response.status).toBe(200);

    // espera o tempo do debounce + margem, sem nunca ver uma resposta
    // automatica aparecer
    await new Promise((resolve) => setTimeout(resolve, 500));

    const sentToThisPatient = fakeMessagingPort.sentMessages.find((m) => m.to === `+${fromPhone}`);
    expect(sentToThisPatient).toBeUndefined();

    const agentMessages = await prisma.message.count({
      where: { conversation: { patientId: patient.id }, role: MessageRole.AGENT },
    });
    expect(agentMessages).toBe(0);
  });
});

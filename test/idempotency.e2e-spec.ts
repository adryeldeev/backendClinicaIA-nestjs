import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MessageRole } from '@prisma/client';
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

const APP_SECRET = 'test-app-secret-idempotency';

describe('Idempotencia do webhook por wamid (Fase 1, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fakeMessagingPort: FakeMessagingPort;

  beforeAll(async () => {
    // Ver comentario equivalente em webhook-echo.e2e-spec.ts: precisa
    // setar o env ANTES do import (dinamico) do AppModule.
    process.env.MESSAGE_DEBOUNCE_MS = '200';
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;

    const { AppModule } = await import('../src/app.module');

    fakeMessagingPort = new FakeMessagingPort();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_PORT)
      .useValue(fakeMessagingPort)
      .overrideProvider(LLM_PORT)
      .useValue(new ScriptedLlmPort([{ text: 'Resposta do assistente.' }]))
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    prisma = moduleRef.get(PrismaService);
    await app.init();
    await waitForQueueWorkersReady(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  it('criterio de aceite #1: mesmo wamid entregue duas vezes gera uma unica resposta', async () => {
    const fromPhone = uniquePhone();
    const { payload, wamid } = buildWhatsappTextPayload({ fromPhone, text: 'ola, tudo bem?' });
    const rawBody = JSON.stringify(payload);
    const signature = signPayload(rawBody, APP_SECRET);

    const send = () =>
      request(app.getHttpServer())
        .post('/webhooks/whatsapp')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .send(rawBody);

    const firstResponse = await send();
    const secondResponse = await send();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);

    // Espera o status terminal, nao so a existencia da linha (PENDING
    // conta como "verdadeiro" pro waitFor, mas o DispatchOutboxJob ainda
    // pode estar rodando — achado da Fase 5, ver webhook-echo.e2e-spec.ts).
    await waitFor(async () => {
      const found = await prisma.outboxMessage.findFirst({ where: { toPhoneE164: `+${fromPhone}` } });
      return found?.status === 'PENDING' ? undefined : found;
    });
    // margem extra: se a segunda entrega fosse reprocessada, uma segunda
    // resposta apareceria dentro desta janela.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const inboundEventCount = await prisma.inboundEvent.count({ where: { externalId: wamid } });
    expect(inboundEventCount).toBe(1);

    const patientMessageCount = await prisma.message.count({ where: { externalId: wamid } });
    expect(patientMessageCount).toBe(1);

    const agentMessageCount = await prisma.message.count({
      where: {
        conversation: { patient: { phoneE164: `+${fromPhone}` } },
        role: MessageRole.AGENT,
      },
    });
    expect(agentMessageCount).toBe(1);

    const sentToPhone = fakeMessagingPort.sentMessages.filter((m) => m.to === `+${fromPhone}`);
    expect(sentToPhone.length).toBe(1);
  });
});

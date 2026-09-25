import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LLM_PORT } from '../src/modules/agent';
import { MESSAGING_PORT } from '../src/modules/messaging';
import {
  OUTBOX_ATTEMPTS,
  OUTBOX_BACKOFF_DELAY_MS,
} from '../src/modules/messaging/application/process-inbound.job';
import { PrismaService } from '../src/shared/database/prisma.service';
import { ScriptedLlmPort } from './agent/support/scripted-llm-port';
import { AlwaysFailingMessagingPort } from './support/always-failing-messaging-port';
import { uniquePhone } from './support/unique-phone';
import { waitFor } from './support/wait-for';
import { waitForQueueWorkersReady } from './support/wait-for-queues-ready';
import { buildWhatsappTextPayload, signPayload } from './support/whatsapp-payload';

const APP_SECRET = 'test-app-secret-outbox-retry';

// Tempo total de espera do BullMQ para esgotar OUTBOX_ATTEMPTS tentativas
// com backoff exponencial: soma de delay * 2^(n-1) para n = 1..(ATTEMPTS-1)
// (a ultima tentativa nao agenda um proximo backoff). Ver
// node_modules/bullmq/dist/cjs/classes/backoffs.js.
function totalBackoffMs(attempts: number, baseDelayMs: number): number {
  let total = 0;
  for (let n = 1; n < attempts; n += 1) {
    total += Math.round(2 ** (n - 1) * baseDelayMs);
  }
  return total;
}

const EXPECTED_BACKOFF_MS = totalBackoffMs(OUTBOX_ATTEMPTS, OUTBOX_BACKOFF_DELAY_MS);
const TEST_TIMEOUT_MS = EXPECTED_BACKOFF_MS + 15000;

describe('Exaustao de retry do outbox (Fase 1, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let failingPort: AlwaysFailingMessagingPort;

  beforeAll(async () => {
    // Ver comentario equivalente em webhook-echo.e2e-spec.ts sobre a
    // ordem entre process.env e o import (dinamico) do AppModule.
    process.env.MESSAGE_DEBOUNCE_MS = '200';
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;

    const { AppModule } = await import('../src/app.module');

    failingPort = new AlwaysFailingMessagingPort();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_PORT)
      .useValue(failingPort)
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

  it(
    `apos esgotar as ${OUTBOX_ATTEMPTS} tentativas, OutboxMessage fica FAILED com attempts=${OUTBOX_ATTEMPTS} ` +
      '(regressao do bug de off-by-one em job.attemptsMade encontrado manualmente na Fase 1)',
    async () => {
      const fromPhone = uniquePhone();
      const { payload } = buildWhatsappTextPayload({
        fromPhone,
        text: 'mensagem que o envio sempre vai falhar',
      });
      const rawBody = JSON.stringify(payload);
      const signature = signPayload(rawBody, APP_SECRET);

      const response = await request(app.getHttpServer())
        .post('/webhooks/whatsapp')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .send(rawBody);
      expect(response.status).toBe(200);

      const outbox = await waitFor(
        async () => {
          const found = await prisma.outboxMessage.findFirst({
            where: { toPhoneE164: `+${fromPhone}` },
          });
          return found && found.status !== 'PENDING' ? found : null;
        },
        { timeoutMs: EXPECTED_BACKOFF_MS + 10000, intervalMs: 300 },
      );

      expect(outbox.status).toBe('FAILED');
      expect(outbox.attempts).toBe(OUTBOX_ATTEMPTS);
      expect(outbox.lastError).toContain('falha simulada de envio');
      expect(failingPort.callCount).toBe(OUTBOX_ATTEMPTS);
    },
    TEST_TIMEOUT_MS,
  );
});

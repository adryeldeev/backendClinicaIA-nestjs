import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureTestApp } from '../support/configure-test-app';
import { waitForQueueWorkersReady } from '../support/wait-for-queues-ready';

/**
 * Caso de override de INBOUND_QUEUE_CONCURRENCY/OUTBOX_QUEUE_CONCURRENCY —
 * ver comentario completo em queue-concurrency.e2e-spec.ts (caso padrao).
 * Precisa de arquivo proprio: `process.env` e mutado ANTES do proprio
 * import do AppModule (mesmo padrao de outbox-dispatch-disabled.e2e-spec.ts),
 * unico jeito confirmado de fazer o `ConfigService` deste teste ler o valor
 * customizado em vez do default cacheado de outro arquivo/teste.
 */
describe('Concorrencia das filas inbound-messages/outbox — override por variavel de ambiente (achado do usuario, 2026-09-24)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    process.env.INBOUND_QUEUE_CONCURRENCY = '12';
    process.env.OUTBOX_QUEUE_CONCURRENCY = '7';
    const { AppModule } = await import('../../src/app.module');

    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureTestApp(app);
    await app.init();
    await waitForQueueWorkersReady(moduleRef);
  });

  afterAll(async () => {
    await app.close();
    delete process.env.INBOUND_QUEUE_CONCURRENCY;
    delete process.env.OUTBOX_QUEUE_CONCURRENCY;
  });

  it('com override por variavel de ambiente, o Worker real reflete o valor configurado', async () => {
    const { ProcessInboundJob } = await import('../../src/modules/messaging/application/process-inbound.job');
    const { DispatchOutboxJob } = await import('../../src/modules/messaging/application/dispatch-outbox.job');

    expect(moduleRef.get(ProcessInboundJob).worker.concurrency).toBe(12);
    expect(moduleRef.get(DispatchOutboxJob).worker.concurrency).toBe(7);
  });
});

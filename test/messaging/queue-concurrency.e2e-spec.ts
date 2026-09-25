import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { DispatchOutboxJob } from '../../src/modules/messaging/application/dispatch-outbox.job';
import { ProcessInboundJob } from '../../src/modules/messaging/application/process-inbound.job';
import { configureTestApp } from '../support/configure-test-app';
import { waitForQueueWorkersReady } from '../support/wait-for-queues-ready';

/**
 * Pedido explicito do usuario (2026-09-24): "a concorrencia das filas.
 * Variavel de ambiente para inbound-messages e outbox, padrao acima de 1.
 * Com concurrency 1 e 10 chamadas por conversa, o pico de segunda de manha
 * enfileira paciente atras de paciente."
 *
 * O BullMQ default e concurrency:1 (confirmado no worker.js do pacote —
 * nao documentado pelo @nestjs/bullmq). `@Processor(...)` e avaliado no
 * IMPORT do modulo, antes do ConfigModule carregar o .env — ler
 * `process.env` la direto so enxergaria variavel de shell real, nunca o
 * `.env` (mesma classe de armadilha de timing ja documentada no CLAUDE.md
 * pra migration vs. codigo). Por isso o valor e aplicado em
 * `onApplicationBootstrap` (ProcessInboundJob/DispatchOutboxJob), quando
 * `ConfigService` ja esta totalmente resolvido — este teste prova que o
 * valor de fato chega no Worker real do BullMQ, nao so que o codigo
 * compila.
 *
 * Caso de override fica em queue-concurrency-override.e2e-spec.ts,
 * arquivo separado — `ConfigService` cacheia a config resolvida entre
 * `Test.createTestingModule().compile()` no MESMO arquivo/processo, entao
 * mutar `process.env` a meio de um describe nao refaz a leitura (confirmado
 * na pratica: um teste tentando os dois casos no mesmo arquivo silenciosamente
 * reusava a config do primeiro). Mesmo padrao ja usado por
 * outbox-dispatch-disabled.e2e-spec.ts: um estado de env por arquivo.
 */
describe('Concorrencia das filas inbound-messages/outbox — padrao (achado do usuario, 2026-09-24)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureTestApp(app);
    await app.init();
    await waitForQueueWorkersReady(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  it('sem override, o padrao (5) e aplicado nos dois Workers — nunca fica no default 1 do BullMQ', () => {
    expect(moduleRef.get(ProcessInboundJob).worker.concurrency).toBe(5);
    expect(moduleRef.get(DispatchOutboxJob).worker.concurrency).toBe(5);
  });
});

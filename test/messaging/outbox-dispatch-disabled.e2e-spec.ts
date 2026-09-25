import 'reflect-metadata';
import { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { OutboxStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaOutboxRepository } from '../../src/modules/messaging/infrastructure/prisma-outbox.repository';
import { MESSAGING_PORT } from '../../src/modules/messaging';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { FakeMessagingPort } from '../support/fake-messaging-port';
import { uniquePhone } from '../support/unique-phone';
import type { DispatchOutboxJob, DispatchOutboxJobData } from '../../src/modules/messaging/application/dispatch-outbox.job';

/**
 * OUTBOX_DISPATCH_ENABLED=false (acrescimo 1 do contrato da Fase 1, achado
 * do front): ninguem conseguia testar o caminho completo de envio sem
 * risco de mandar WhatsApp REAL pra um dos poucos numeros de teste da
 * Meta. Desligado, o outbox enche e o status vira SKIPPED (o front ve o
 * ciclo completo sem ler "entregue" pra mensagem que nunca saiu — achado
 * do usuario, 2026-09-24: SENT aqui era dado falso), mas o MessagingPort
 * NUNCA e chamado — nem o fake, prova que o bypass acontece antes da
 * chamada, nao so que "da certo".
 *
 * `true` e o padrao em toda a suite (test/support/test-env.ts) — este
 * arquivo sobrescreve pra "false" antes do PROPRIO import do AppModule,
 * unico lugar que testa o caminho desligado de verdade.
 */
describe('DispatchOutboxJob — OUTBOX_DISPATCH_ENABLED=false (e2e)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let dispatchOutboxJob: DispatchOutboxJob;
  let outbox: PrismaOutboxRepository;
  let fakeMessagingPort: FakeMessagingPort;

  beforeAll(async () => {
    process.env.OUTBOX_DISPATCH_ENABLED = 'false';
    const { AppModule } = await import('../../src/app.module');
    const { DispatchOutboxJob: DispatchOutboxJobClass } = await import(
      '../../src/modules/messaging/application/dispatch-outbox.job'
    );

    fakeMessagingPort = new FakeMessagingPort();
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_PORT)
      .useValue(fakeMessagingPort)
      .compile();

    prisma = moduleRef.get(PrismaService);
    dispatchOutboxJob = moduleRef.get(DispatchOutboxJobClass);
    outbox = moduleRef.get(PrismaOutboxRepository);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('texto livre: marca SKIPPED (nunca SENT) e loga, sem chamar o MessagingPort (nem o fake)', async () => {
    const phone = `+${uniquePhone()}`;
    const patient = await prisma.patient.create({ data: { phoneE164: phone } });
    await prisma.conversation.create({
      data: { patientId: patient.id, lastInboundAt: new Date(), windowExpiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000) },
    });

    const outboxMessage = await outbox.create(phone, 'Mensagem que nunca deveria sair de verdade.');
    await dispatchOutboxJob.process({ data: { outboxMessageId: outboxMessage.id } } as Job<DispatchOutboxJobData>);

    expect(fakeMessagingPort.sentMessages).toHaveLength(0);
    const updated = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: outboxMessage.id } });
    // Achado do usuario (2026-09-24): SENT aqui era dado falso — o painel
    // mostrava "entregue" pra mensagem que nunca saiu. SKIPPED e honesto.
    expect(updated.status).toBe(OutboxStatus.SKIPPED);
    expect(updated.sentAt).toBeNull();
  });

  it('RN-18 (janela expirada) continua valendo mesmo com a flag desligada — nao vira SENT por engano', async () => {
    const phone = `+${uniquePhone()}`;
    const patient = await prisma.patient.create({ data: { phoneE164: phone } });
    await prisma.conversation.create({
      data: {
        patientId: patient.id,
        lastInboundAt: new Date(Date.now() - 30 * 60 * 60 * 1000),
        windowExpiresAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      },
    });

    const outboxMessage = await outbox.create(phone, 'Nao deveria sair — janela fechada, mesmo com a flag desligada.');
    await dispatchOutboxJob.process({ data: { outboxMessageId: outboxMessage.id } } as Job<DispatchOutboxJobData>);

    const updated = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: outboxMessage.id } });
    expect(updated.status).toBe(OutboxStatus.FAILED);
    expect(updated.lastError).toContain('window_expired');
  });
});

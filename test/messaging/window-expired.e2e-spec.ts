import 'reflect-metadata';
import { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { OutboxStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DispatchOutboxJob, type DispatchOutboxJobData } from '../../src/modules/messaging/application/dispatch-outbox.job';
import { PrismaOutboxRepository } from '../../src/modules/messaging/infrastructure/prisma-outbox.repository';
import { MESSAGING_PORT } from '../../src/modules/messaging';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { FakeMessagingPort } from '../support/fake-messaging-port';
import { uniquePhone } from '../support/unique-phone';

/**
 * RN-18: fora da janela de 24h do WhatsApp so e possivel enviar template
 * aprovado. Achado no levantamento da Fase 5: Conversation.windowExpiresAt
 * ja era ESCRITO (RecordInboundMessageUseCase) mas nunca LIDO — o outbox
 * mandava texto livre sem checar. Este teste prova a checagem: recusa
 * ANTES de tentar (nao e falha transitoria, e regra deterministica), sem
 * nunca chamar o MessagingPort.
 */
describe('DispatchOutboxJob — janela de 24h (RN-18)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let dispatchOutboxJob: DispatchOutboxJob;
  let outbox: PrismaOutboxRepository;
  let fakeMessagingPort: FakeMessagingPort;

  beforeAll(async () => {
    const { AppModule } = await import('../../src/app.module');

    fakeMessagingPort = new FakeMessagingPort();
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_PORT)
      .useValue(fakeMessagingPort)
      .compile();

    prisma = moduleRef.get(PrismaService);
    dispatchOutboxJob = moduleRef.get(DispatchOutboxJob);
    outbox = moduleRef.get(PrismaOutboxRepository);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('texto livre com janela expirada e marcado FAILED sem tentar enviar', async () => {
    const phone = `+${uniquePhone()}`;
    const patient = await prisma.patient.create({ data: { phoneE164: phone } });
    await prisma.conversation.create({
      data: {
        patientId: patient.id,
        lastInboundAt: new Date(Date.now() - 30 * 60 * 60 * 1000), // 30h atras
        windowExpiresAt: new Date(Date.now() - 6 * 60 * 60 * 1000), // expirou ha 6h
      },
    });

    const outboxMessage = await outbox.create(phone, 'Resposta que nao deveria sair — janela fechada.');

    await dispatchOutboxJob.process({ data: { outboxMessageId: outboxMessage.id } } as Job<DispatchOutboxJobData>);

    expect(fakeMessagingPort.sentMessages).toHaveLength(0);

    const updated = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: outboxMessage.id } });
    expect(updated.status).toBe(OutboxStatus.FAILED);
    expect(updated.lastError).toContain('window_expired');
  });

  it('texto livre com janela aberta continua enviando normalmente', async () => {
    const phone = `+${uniquePhone()}`;
    const patient = await prisma.patient.create({ data: { phoneE164: phone } });
    await prisma.conversation.create({
      data: {
        patientId: patient.id,
        lastInboundAt: new Date(),
        windowExpiresAt: new Date(Date.now() + 20 * 60 * 60 * 1000), // abre por mais 20h
      },
    });

    const outboxMessage = await outbox.create(phone, 'Resposta normal, janela aberta.');

    await dispatchOutboxJob.process({ data: { outboxMessageId: outboxMessage.id } } as Job<DispatchOutboxJobData>);

    expect(fakeMessagingPort.sentMessages).toHaveLength(1);
    const updated = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: outboxMessage.id } });
    expect(updated.status).toBe(OutboxStatus.SENT);
  });

  it('template ignora a janela — sempre pode ser enviado', async () => {
    const phone = `+${uniquePhone()}`;
    const patient = await prisma.patient.create({ data: { phoneE164: phone } });
    await prisma.conversation.create({
      data: {
        patientId: patient.id,
        lastInboundAt: new Date(Date.now() - 30 * 60 * 60 * 1000),
        windowExpiresAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
      },
    });

    const outboxMessage = await outbox.createTemplate(phone, 'lembrete_consulta_24h', ['Consulta', 'Dr. Teste', 'amanha as 10h']);

    await dispatchOutboxJob.process({ data: { outboxMessageId: outboxMessage.id } } as Job<DispatchOutboxJobData>);

    expect(fakeMessagingPort.sentTemplates).toHaveLength(1);
    const updated = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: outboxMessage.id } });
    expect(updated.status).toBe(OutboxStatus.SENT);
  });
});

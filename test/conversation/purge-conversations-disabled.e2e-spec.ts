import 'reflect-metadata';
import { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConversationStatus, MessageRole } from '@prisma/client';
import type { Job } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PurgeConversationsJob } from '../../src/modules/conversation/application/purge-conversations.job';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { CLOCK } from '../../src/shared/kernel/clock';
import { FixedClock } from '../support/fixed-clock';
import { uniquePhone } from '../support/unique-phone';

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXED_NOW = new Date('2026-01-15T12:00:00.000Z');
const RETENTION_DAYS = 180;

/**
 * Arquivo SEPARADO de proposito (nao um segundo describe em
 * purge-conversations.e2e-spec.ts) — achado ao escrever este teste:
 * `ConfigModule.forRoot()` roda dentro do `@Module()` de AppModule, e o
 * import dinamico de app.module.ts so executa de verdade na PRIMEIRA vez
 * dentro do mesmo arquivo (cache de modulo do Node/Vite por arquivo). Um
 * segundo `describe` no mesmo arquivo, mesmo mudando process.env antes do
 * import, reaproveitaria a validacao de env ja feita pelo primeiro
 * describe — testei e confirmei o bug source (validateEnv so era chamado
 * uma vez, o segundo describe herdava RETENTION_PURGE_ENABLED=true do
 * primeiro mesmo com o env var deletado). Mesmo padrao usado no resto da
 * suite: um arquivo, uma configuracao de env pro AppModule.
 *
 * Achado do incidente de 2026-09-23 (ver CLAUDE.md): um boot em dev nao
 * pode redigir conversa de verdade so por a aplicacao ter subido — prova
 * o default REAL de RETENTION_PURGE_ENABLED (env.schema.ts), sem forcar
 * nada no teste.
 */
describe('PurgeConversationsJob — RETENTION_PURGE_ENABLED desligada (padrao)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let job: PurgeConversationsJob;

  beforeAll(async () => {
    process.env.CONVERSATION_RETENTION_DAYS = String(RETENTION_DAYS);
    const { AppModule } = await import('../../src/app.module');

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(new FixedClock(FIXED_NOW))
      .compile();

    prisma = moduleRef.get(PrismaService);
    job = moduleRef.get(PurgeConversationsJob);
  });

  afterAll(async () => {
    delete process.env.CONVERSATION_RETENTION_DAYS;
    await moduleRef.close();
  });

  it('conversa claramente elegivel para expurgo NAO e tocada — flag desligada (default)', async () => {
    const phone = `+${uniquePhone()}`;
    const patient = await prisma.patient.create({ data: { phoneE164: phone } });
    const oldTimestamp = new Date(FIXED_NOW.getTime() - (RETENTION_DAYS + 10) * DAY_MS);
    const conversation = await prisma.conversation.create({
      data: {
        patientId: patient.id,
        status: ConversationStatus.AWAITING_HUMAN,
        context: { nomeColetado: 'Fulano de Tal' },
        lastInboundAt: oldTimestamp,
        lastActivityAt: oldTimestamp, // RN-22 decide por isso agora, nao lastInboundAt
      },
    });
    const message = await prisma.message.create({
      data: { conversationId: conversation.id, role: MessageRole.PATIENT, content: 'nao deveria ser redigida' },
    });

    await job.process({} as Job);

    const messageAfter = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(messageAfter.content).toBe('nao deveria ser redigida');

    const conversationAfter = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conversationAfter.status).toBe(ConversationStatus.AWAITING_HUMAN);
    expect(conversationAfter.context).toEqual({ nomeColetado: 'Fulano de Tal' });
  });
});

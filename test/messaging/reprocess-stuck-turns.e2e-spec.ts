import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ConversationStatus, MessageRole } from '@prisma/client';
import type { Job } from 'bullmq';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LLM_PORT } from '../../src/modules/agent';
import { MESSAGING_PORT } from '../../src/modules/messaging';
import { ReprocessStuckTurnsJob } from '../../src/modules/messaging/application/reprocess-stuck-turns.job';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { CLOCK } from '../../src/shared/kernel/clock';
import { ScriptedLlmPort } from '../agent/support/scripted-llm-port';
import { FakeMessagingPort } from '../support/fake-messaging-port';
import { FixedClock } from '../support/fixed-clock';
import { uniquePhone } from '../support/unique-phone';
import { waitFor } from '../support/wait-for';
import { waitForQueueWorkersReady } from '../support/wait-for-queues-ready';

const MINUTE_MS = 60 * 1000;
const FIXED_NOW = new Date('2026-01-15T12:00:00.000Z');

/**
 * RN-16 (job varredor, achado no teste manual da Fase 3): mensagem
 * presa por llm_error (nao marca consumido nem escala, de proposito) so
 * reprocessa sozinha depois de STUCK_MESSAGE_REPROCESS_MINUTES, mesmo
 * que o paciente nunca mande outra mensagem.
 */
describe('ReprocessStuckTurnsJob (RN-16)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let job: ReprocessStuckTurnsJob;
  let fakeMessagingPort: FakeMessagingPort;
  let scriptedLlmPort: ScriptedLlmPort;

  beforeAll(async () => {
    const { AppModule } = await import('../../src/app.module');

    fakeMessagingPort = new FakeMessagingPort();
    scriptedLlmPort = new ScriptedLlmPort([{ text: 'Consegui responder no reprocessamento.' }]);

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_PORT)
      .useValue(fakeMessagingPort)
      .overrideProvider(LLM_PORT)
      .useValue(scriptedLlmPort)
      .overrideProvider(CLOCK)
      .useValue(new FixedClock(FIXED_NOW))
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    prisma = moduleRef.get(PrismaService);
    job = moduleRef.get(ReprocessStuckTurnsJob);
    await app.init();
    await waitForQueueWorkersReady(moduleRef);
  });

  // Achado do usuario (incidente de 2026-09-23): mensagem de paciente
  // deixada sem consumir e sem conversa/patient limpos e exatamente o tipo
  // de fixture que RN-16 (ReprocessStuckTurnsJob, funcionando como
  // projetado) reencontra e reprocessa mais tarde — dentro da propria
  // suite (se um teste demorar o suficiente) ou, pior, se uma aplicacao de
  // verdade algum dia apontar pro mesmo banco. Cada teste registra o que
  // criou e este afterEach apaga na ordem certa (Message -> Conversation ->
  // Patient, sem onDelete:Cascade no schema).
  let createdConversationIds: string[] = [];

  afterEach(async () => {
    if (createdConversationIds.length === 0) return;
    const conversations = await prisma.conversation.findMany({
      where: { id: { in: createdConversationIds } },
      select: { id: true, patientId: true },
    });
    await prisma.message.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: conversations.map((c) => c.patientId) } } });
    createdConversationIds = [];
  });

  afterAll(async () => {
    await app.close();
  });

  it('mensagem parada ha mais de STUCK_MESSAGE_REPROCESS_MINUTES e reenfileirada e responde sozinha', async () => {
    const phone = `+${uniquePhone()}`;
    const patient = await prisma.patient.create({ data: { phoneE164: phone } });
    const conversation = await prisma.conversation.create({
      data: {
        patientId: patient.id,
        status: ConversationStatus.BOT,
        // Janela de 24h ainda aberta — reflete a realidade: foi setada
        // quando a mensagem presa chegou, bem antes de expirar so por
        // causa de 20min de atraso no reprocessamento.
        lastInboundAt: new Date(FIXED_NOW.getTime() - 20 * MINUTE_MS),
        windowExpiresAt: new Date(FIXED_NOW.getTime() + 23 * 60 * MINUTE_MS),
      },
    });
    createdConversationIds.push(conversation.id);
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: MessageRole.PATIENT,
        content: 'oi, alguem ai?',
        createdAt: new Date(FIXED_NOW.getTime() - 20 * MINUTE_MS), // presa ha 20min (limiar default 15min)
      },
    });

    await job.process({} as Job);

    const sent = await waitFor(() => Promise.resolve(fakeMessagingPort.sentMessages.find((m) => m.to === phone)));
    expect(sent.body).toBe('Consegui responder no reprocessamento.');

    const messageAfter = await prisma.message.findFirstOrThrow({
      where: { conversationId: conversation.id, role: MessageRole.PATIENT },
    });
    expect(messageAfter.consumedAt).not.toBeNull();
  });

  it('mensagem recente (dentro do limiar) nao e reprocessada ainda', async () => {
    const phone = `+${uniquePhone()}`;
    const patient = await prisma.patient.create({ data: { phoneE164: phone } });
    const conversation = await prisma.conversation.create({
      data: { patientId: patient.id, status: ConversationStatus.BOT },
    });
    createdConversationIds.push(conversation.id);
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: MessageRole.PATIENT,
        content: 'mensagem recente, ainda dentro do debounce/processamento normal',
        createdAt: new Date(FIXED_NOW.getTime() - 2 * MINUTE_MS),
      },
    });

    await job.process({} as Job);

    // De-proposito: sem waitFor (nao ha nada assincrono esperado aqui) —
    // confere direto que nada foi enfileirado/enviado.
    const sent = fakeMessagingPort.sentMessages.find((m) => m.to === phone);
    expect(sent).toBeUndefined();
  });

  it('conversa em HUMAN nao e reprocessada mesmo com mensagem presa ha muito tempo', async () => {
    const phone = `+${uniquePhone()}`;
    const patient = await prisma.patient.create({ data: { phoneE164: phone } });
    const conversation = await prisma.conversation.create({
      data: { patientId: patient.id, status: ConversationStatus.HUMAN },
    });
    createdConversationIds.push(conversation.id);
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: MessageRole.PATIENT,
        content: 'paciente em atendimento humano',
        createdAt: new Date(FIXED_NOW.getTime() - 60 * MINUTE_MS),
      },
    });

    await job.process({} as Job);

    const sent = fakeMessagingPort.sentMessages.find((m) => m.to === phone);
    expect(sent).toBeUndefined();
  });
});

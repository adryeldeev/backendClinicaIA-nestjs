import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConversationStatus, MessageRole } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LLM_PORT } from '../../src/modules/agent';
import { HandleDebouncedMessageUseCase } from '../../src/modules/conversation';
import { MESSAGING_PORT } from '../../src/modules/messaging';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { ScriptedLlmPort } from '../agent/support/scripted-llm-port';
import { FakeMessagingPort } from '../support/fake-messaging-port';
import { uniquePhone } from '../support/unique-phone';

const THRESHOLD = 2;
const LLM_ERROR = () => new Error('gemini_request_failed: HTTP 503 (simulado)');

/**
 * RN-16, segunda peca (achado do incidente de 2026-09-23): sem teto, uma
 * instabilidade sustentada do provedor faz o mesmo turno falhar por
 * llm_error pra sempre — ReprocessStuckTurnsJob so reenfileira, e sem
 * limite reenfileiraria a mesma conversa a cada tick indefinidamente,
 * queimando cota sem nunca escalar. Testado direto via
 * HandleDebouncedMessageUseCase (o componente que decide
 * reprocessar-de-novo-ou-escalar), sem esperar REPROCESS_CHECK_INTERVAL_MS
 * de verdade.
 */
describe('Teto de reprocessamento do RN-16 (LLM_ERROR_ESCALATION_THRESHOLD)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let handleDebouncedMessage: HandleDebouncedMessageUseCase;
  let fakeMessagingPort: FakeMessagingPort;
  let scriptedLlmPort: ScriptedLlmPort;
  let createdConversationIds: string[] = [];

  beforeAll(async () => {
    process.env.LLM_ERROR_ESCALATION_THRESHOLD = String(THRESHOLD);

    const { AppModule } = await import('../../src/app.module');

    fakeMessagingPort = new FakeMessagingPort();
    scriptedLlmPort = new ScriptedLlmPort([{ text: 'placeholder' }]);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_PORT)
      .useValue(fakeMessagingPort)
      .overrideProvider(LLM_PORT)
      .useValue(scriptedLlmPort)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    prisma = moduleRef.get(PrismaService);
    handleDebouncedMessage = moduleRef.get(HandleDebouncedMessageUseCase);
    await app.init();
  });

  afterEach(async () => {
    if (createdConversationIds.length === 0) return;
    const conversations = await prisma.conversation.findMany({
      where: { id: { in: createdConversationIds } },
      select: { id: true, patientId: true },
    });
    await prisma.handoffTicket.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.message.deleteMany({ where: { conversationId: { in: createdConversationIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: conversations.map((c) => c.patientId) } } });
    createdConversationIds = [];
  });

  afterAll(async () => {
    await app.close();
  });

  async function createStuckConversation(): Promise<string> {
    const phone = `+${uniquePhone()}`;
    const patient = await prisma.patient.create({ data: { phoneE164: phone } });
    const conversation = await prisma.conversation.create({
      data: { patientId: patient.id, status: ConversationStatus.BOT },
    });
    createdConversationIds.push(conversation.id);
    return conversation.id;
  }

  async function addUnconsumedPatientMessage(conversationId: string, content: string): Promise<void> {
    await prisma.message.create({ data: { conversationId, role: MessageRole.PATIENT, content } });
  }

  it(`escala pra humano na ${THRESHOLD}a falha CONSECUTIVA de llm_error, em vez de reprocessar pra sempre`, async () => {
    const conversationId = await createStuckConversation();
    await addUnconsumedPatientMessage(conversationId, 'oi, alguem ai?');

    scriptedLlmPort.setScript([{ throws: LLM_ERROR() }, { throws: LLM_ERROR() }]);

    const firstAttempt = await handleDebouncedMessage.execute(conversationId);
    expect(firstAttempt).toEqual({ skipped: true, reason: 'llm_unavailable' });

    const afterFirstAttempt = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(afterFirstAttempt.status).toBe(ConversationStatus.BOT);
    expect(afterFirstAttempt.consecutiveLlmErrors).toBe(1);
    const messageAfterFirst = await prisma.message.findFirstOrThrow({ where: { conversationId } });
    expect(messageAfterFirst.consumedAt).toBeNull();

    // 2a chamada (o que ReprocessStuckTurnsJob faria no proximo tick):
    // atinge o limite (THRESHOLD=2) — escala em vez de deixar pendente de novo.
    const secondAttempt = await handleDebouncedMessage.execute(conversationId);
    expect(secondAttempt).toEqual({ skipped: true, reason: 'escalated' });

    const afterSecondAttempt = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(afterSecondAttempt.status).toBe(ConversationStatus.AWAITING_HUMAN);
    // Zerado ao escalar — nao deveria "herdar" falhas de uma escalada ja fechada.
    expect(afterSecondAttempt.consecutiveLlmErrors).toBe(0);

    const messageAfterSecond = await prisma.message.findFirstOrThrow({ where: { conversationId } });
    expect(messageAfterSecond.consumedAt).not.toBeNull();

    const ticket = await prisma.handoffTicket.findFirstOrThrow({ where: { conversationId } });
    expect(ticket.reason).toBe('llm_error_max_retries');
    expect(ticket.summary).toContain('2');

    expect(fakeMessagingPort.sentMessages).toHaveLength(0);
  });

  it('turno bem-sucedido zera o contador — falha isolada depois de um sucesso NAO escala', async () => {
    const conversationId = await createStuckConversation();
    await addUnconsumedPatientMessage(conversationId, 'primeira mensagem');

    scriptedLlmPort.setScript([{ throws: LLM_ERROR() }]);
    const firstAttempt = await handleDebouncedMessage.execute(conversationId);
    expect(firstAttempt).toEqual({ skipped: true, reason: 'llm_unavailable' });

    const afterFailure = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(afterFailure.consecutiveLlmErrors).toBe(1);

    // Provedor volta: turno seguinte responde normal.
    scriptedLlmPort.setScript([{ text: 'Consegui responder agora.' }]);
    const successAttempt = await handleDebouncedMessage.execute(conversationId);
    expect(successAttempt).toMatchObject({ skipped: false });

    const afterSuccess = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(afterSuccess.consecutiveLlmErrors).toBe(0);

    // Nova mensagem, nova falha isolada — contador comecou de 0, THRESHOLD=2
    // exige outra falha CONSECUTIVA antes de escalar.
    await addUnconsumedPatientMessage(conversationId, 'segunda mensagem, depois do sucesso');
    scriptedLlmPort.setScript([{ throws: LLM_ERROR() }]);
    const failureAfterSuccess = await handleDebouncedMessage.execute(conversationId);
    expect(failureAfterSuccess).toEqual({ skipped: true, reason: 'llm_unavailable' });

    const finalState = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(finalState.status).toBe(ConversationStatus.BOT);
    expect(finalState.consecutiveLlmErrors).toBe(1);

    const ticket = await prisma.handoffTicket.findFirst({ where: { conversationId } });
    expect(ticket).toBeNull();
  });
});

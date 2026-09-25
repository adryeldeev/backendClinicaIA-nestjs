import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConversationStatus, MessageRole } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { LLM_PORT } from '../../src/modules/agent';
import { HandleDebouncedMessageUseCase } from '../../src/modules/conversation';
import { MESSAGING_PORT } from '../../src/modules/messaging';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { ScriptedLlmPort } from '../agent/support/scripted-llm-port';
import { FakeMessagingPort } from '../support/fake-messaging-port';
import { uniquePhone } from '../support/unique-phone';
import { withAiDisabled } from '../support/with-ai-disabled';

/**
 * RN-25 fim a fim: com a IA desligada globalmente, uma mensagem nova NAO
 * chama o LLM, fica marcada consumida (mesmo tratamento de HUMAN — foi
 * "vista", so nao gera resposta automatica) e a conversa continua em BOT
 * (nao escala, nao e um erro — e um estado deliberado, temporario).
 *
 * Ver test/support/with-ai-disabled.ts pro motivo de usar a clinica
 * primaria DE VERDADE (com save/restore) em vez de fabricar uma "mais
 * antiga" — a segunda abordagem parecia mais isolada mas nao e
 * deterministica (achado real desta etapa).
 */
describe('HandleDebouncedMessageUseCase — RN-25 (IA desligada globalmente) (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let handleDebouncedMessage: HandleDebouncedMessageUseCase;
  let scriptedLlmPort: ScriptedLlmPort;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_PORT)
      .useValue(new FakeMessagingPort())
      .overrideProvider(LLM_PORT)
      .useValue(new ScriptedLlmPort([{ text: 'Isso nunca deveria ser chamado.' }]))
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    prisma = moduleRef.get(PrismaService);
    handleDebouncedMessage = moduleRef.get(HandleDebouncedMessageUseCase);
    scriptedLlmPort = moduleRef.get(LLM_PORT);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('mensagem nova com IA desligada: nao chama o LLM, marca consumida, conversa continua BOT', async () => {
    await withAiDisabled(prisma, false, async () => {
      const patient = await prisma.patient.create({ data: { phoneE164: `+${uniquePhone()}` } });
      const conversation = await prisma.conversation.create({
        data: { patientId: patient.id, status: ConversationStatus.BOT },
      });
      const message = await prisma.message.create({
        data: { conversationId: conversation.id, role: MessageRole.PATIENT, content: 'alguem ai?' },
      });

      const result = await handleDebouncedMessage.execute(conversation.id);

      expect(result).toEqual({ skipped: true, reason: 'ai_disabled' });
      expect(scriptedLlmPort.callCount).toBe(0);

      const messageAfter = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
      expect(messageAfter.consumedAt).not.toBeNull();

      const conversationAfter = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
      expect(conversationAfter.status).toBe(ConversationStatus.BOT);

      const agentMessages = await prisma.message.count({
        where: { conversationId: conversation.id, role: MessageRole.AGENT },
      });
      expect(agentMessages).toBe(0);
    });
  });
});

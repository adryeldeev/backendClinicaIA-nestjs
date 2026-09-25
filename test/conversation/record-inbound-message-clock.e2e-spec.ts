import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecordInboundMessageUseCase } from '../../src/modules/conversation';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { CLOCK } from '../../src/shared/kernel/clock';
import { FixedClock } from '../support/fixed-clock';
import { uniquePhone } from '../support/unique-phone';

const FIXED_NOW = new Date('2026-01-15T12:00:00.000Z');

/**
 * Varredura pedida pelo usuario apos o achado do AuditLog.createdAt: outro
 * lugar que decidia por tempo sem passar pelo Clock injetado.
 * RecordInboundMessageUseCase usava `new Date()` cru pra calcular
 * `Conversation.lastInboundAt`/`windowExpiresAt` (RN-18) — sob relogio real
 * isso nunca deu problema (Clock de producao E' o relogio real), mas
 * quebra qualquer teste que precise controlar "agora" pra essa janela.
 * `Message.createdAt` tinha o mesmo problema (so `@default(now())` do
 * schema) — RN-16 (findConversationIdsWithStuckMessages) decide
 * reprocessamento comparando esse valor contra um cutoff do Clock.
 */
describe('RecordInboundMessageUseCase — Clock injetado, nao relogio real (achado da varredura pos-AuditLog)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let recordInboundMessage: RecordInboundMessageUseCase;

  beforeAll(async () => {
    const { AppModule } = await import('../../src/app.module');
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(new FixedClock(FIXED_NOW))
      .compile();
    prisma = moduleRef.get(PrismaService);
    recordInboundMessage = moduleRef.get(RecordInboundMessageUseCase);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('Message.createdAt, Conversation.lastInboundAt e windowExpiresAt usam o Clock fixado, nunca o relogio real', async () => {
    const phone = `+${uniquePhone()}`;
    const patient = await prisma.patient.create({ data: { phoneE164: phone } });
    const conversation = await prisma.conversation.create({ data: { patientId: patient.id } });

    await recordInboundMessage.execute({
      conversationId: conversation.id,
      content: 'mensagem de teste',
      externalId: `wamid.clock-test-${uniquePhone()}`,
    });

    const message = await prisma.message.findFirstOrThrow({ where: { conversationId: conversation.id } });
    expect(message.createdAt.getTime()).toBe(FIXED_NOW.getTime());

    const conversationAfter = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conversationAfter.lastInboundAt?.getTime()).toBe(FIXED_NOW.getTime());
    expect(conversationAfter.windowExpiresAt?.getTime()).toBe(FIXED_NOW.getTime() + 24 * 60 * 60 * 1000);
    // RN-22: mensagem e atividade real, tem que estampar lastActivityAt
    // com o mesmo instante do Clock (nunca o relogio real do @updatedAt).
    expect(conversationAfter.lastActivityAt.getTime()).toBe(FIXED_NOW.getTime());
  });
});

import { Inject, Injectable } from '@nestjs/common';
import { MessageRole } from '@prisma/client';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { PrismaConversationRepository } from '../infrastructure/prisma-conversation.repository';
import { PrismaMessageRepository } from '../infrastructure/prisma-message.repository';

const WHATSAPP_WINDOW_HOURS = 24;

export interface RecordInboundMessageInput {
  conversationId: string;
  content: string;
  externalId: string;
}

@Injectable()
export class RecordInboundMessageUseCase {
  constructor(
    private readonly messages: PrismaMessageRepository,
    private readonly conversations: PrismaConversationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(input: RecordInboundMessageInput): Promise<void> {
    const now = this.clock.now();

    await this.messages.create({
      conversationId: input.conversationId,
      role: MessageRole.PATIENT,
      content: input.content,
      externalId: input.externalId,
      createdAt: now,
    });

    const windowExpiresAt = new Date(now.getTime() + WHATSAPP_WINDOW_HOURS * 60 * 60 * 1000);
    await this.conversations.markInbound(input.conversationId, now, windowExpiresAt);
  }
}

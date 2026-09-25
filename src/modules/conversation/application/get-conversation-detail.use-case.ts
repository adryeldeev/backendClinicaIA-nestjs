import { Injectable } from '@nestjs/common';
import { ConversationNotFoundError } from '../domain/errors/conversation-not-found.error';
import { ConversationWithPatient, PrismaConversationRepository } from '../infrastructure/prisma-conversation.repository';
import { MessageWithDelivery, PrismaMessageRepository } from '../infrastructure/prisma-message.repository';

export interface ConversationDetail {
  conversation: ConversationWithPatient;
  messages: MessageWithDelivery[];
}

/** GET /api/admin/conversations/:id — historico completo. */
@Injectable()
export class GetConversationDetailUseCase {
  constructor(
    private readonly conversations: PrismaConversationRepository,
    private readonly messages: PrismaMessageRepository,
  ) {}

  async execute(conversationId: string): Promise<ConversationDetail> {
    const conversation = await this.conversations.findByIdWithPatient(conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId);
    }
    const messages = await this.messages.listAllByConversation(conversationId);
    return { conversation, messages };
  }
}

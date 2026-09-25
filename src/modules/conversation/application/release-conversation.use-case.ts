import { Injectable } from '@nestjs/common';
import { Conversation, ConversationStatus } from '@prisma/client';
import { ConversationNotFoundError } from '../domain/errors/conversation-not-found.error';
import { InvalidConversationTransitionError } from '../domain/errors/invalid-conversation-transition.error';
import { PrismaConversationRepository } from '../infrastructure/prisma-conversation.repository';

/** POST /api/admin/conversations/:id/release: HUMAN -> BOT. */
@Injectable()
export class ReleaseConversationUseCase {
  constructor(private readonly conversations: PrismaConversationRepository) {}

  async execute(conversationId: string): Promise<Conversation> {
    const conversation = await this.conversations.findByIdWithPatient(conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId);
    }
    if (conversation.status !== ConversationStatus.HUMAN) {
      throw new InvalidConversationTransitionError(conversation.status, ConversationStatus.HUMAN);
    }

    await this.conversations.setStatus(conversationId, ConversationStatus.BOT);
    // Ninguem do painel esta mais responsavel — limpa assignedUserId
    // (contrato da Fase 1, divergencia #6). Sem isso, a proxima escalada
    // pra AWAITING_HUMAN mostraria a mesma recepcionista de antes como
    // "ja assumindo", mesmo sem ela ter feito nada desta vez.
    return this.conversations.setAssignedUser(conversationId, null);
  }
}

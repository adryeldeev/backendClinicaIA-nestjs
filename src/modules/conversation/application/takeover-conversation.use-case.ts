import { Inject, Injectable } from '@nestjs/common';
import { Conversation, ConversationStatus } from '@prisma/client';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { ConversationNotFoundError } from '../domain/errors/conversation-not-found.error';
import { InvalidConversationTransitionError } from '../domain/errors/invalid-conversation-transition.error';
import { PrismaConversationRepository } from '../infrastructure/prisma-conversation.repository';
import { PrismaHandoffTicketRepository } from '../infrastructure/prisma-handoff-ticket.repository';

const TAKEOVER_ALLOWED_FROM: ConversationStatus[] = [ConversationStatus.AWAITING_HUMAN, ConversationStatus.BOT];

/**
 * POST /api/admin/conversations/:id/takeover: BOT ou AWAITING_HUMAN -> HUMAN
 * (contrato da Fase 1, divergencia #7 — antes so aceitava AWAITING_HUMAN).
 * Achado do front: a recepcionista pode querer assumir uma conversa que
 * esta com a IA sem mandar mensagem — antes disso a unica saida era
 * responder, que ja e assuncao implicita (RN-26). As duas formas coexistem.
 * Fecha tambem o HandoffTicket aberto, se existir (achado da Etapa 1/Fase 5:
 * nada setava `resolvedAt` antes disso) e marca `assignedUserId` (divergencia
 * #6 — "quem assumiu", pra "duas recepcionistas" aparecer na tela).
 */
@Injectable()
export class TakeoverConversationUseCase {
  constructor(
    private readonly conversations: PrismaConversationRepository,
    private readonly handoffTickets: PrismaHandoffTicketRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(conversationId: string, userId: string): Promise<Conversation> {
    const conversation = await this.conversations.findByIdWithPatient(conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId);
    }
    if (!TAKEOVER_ALLOWED_FROM.includes(conversation.status)) {
      throw new InvalidConversationTransitionError(conversation.status, TAKEOVER_ALLOWED_FROM.join(' ou '));
    }

    await this.conversations.setStatus(conversationId, ConversationStatus.HUMAN);
    const updated = await this.conversations.setAssignedUser(conversationId, userId);

    const openTicket = await this.handoffTickets.findOpenByConversation(conversationId);
    if (openTicket) {
      await this.handoffTickets.resolve(openTicket.id, this.clock.now());
    }

    return updated;
  }
}

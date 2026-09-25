import { Inject, Injectable } from '@nestjs/common';
import { ConversationStatus } from '@prisma/client';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { ConversationNotFoundError } from '../domain/errors/conversation-not-found.error';
import { PrismaConversationRepository } from '../infrastructure/prisma-conversation.repository';
import { PrismaHandoffTicketRepository } from '../infrastructure/prisma-handoff-ticket.repository';

/**
 * RN-26 (assunção implícita): usado por SendAdminMessageUseCase
 * (messaging) antes de enfileirar uma mensagem do painel. Cobre os dois
 * estados de onde uma conversa pode vir quando alguem do painel decide
 * responder sem passar pelo botao "assumir": BOT (o caso comum — a
 * recepcionista ve e ja responde) e AWAITING_HUMAN (mesmo efeito do
 * takeover explicito, inclusive fechando o HandoffTicket aberto). Se ja
 * estiver HUMAN, e no-op — a maioria das mensagens numa conversa em
 * atendimento humano cai aqui.
 */
@Injectable()
export class EnsureHumanAssignedUseCase {
  constructor(
    private readonly conversations: PrismaConversationRepository,
    private readonly handoffTickets: PrismaHandoffTicketRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(conversationId: string, userId: string): Promise<void> {
    const conversation = await this.conversations.findByIdWithPatient(conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId);
    }
    if (conversation.status === ConversationStatus.HUMAN) {
      // Ja em HUMAN — ainda assim atualiza quem esta assumindo agora
      // (contrato da Fase 1, divergencia #6): outra pessoa do painel pode
      // ter mandado a proxima mensagem, e a tela precisa refletir isso.
      await this.conversations.setAssignedUser(conversationId, userId);
      return;
    }

    await this.conversations.setStatus(conversationId, ConversationStatus.HUMAN);
    await this.conversations.setAssignedUser(conversationId, userId);

    const openTicket = await this.handoffTickets.findOpenByConversation(conversationId);
    if (openTicket) {
      await this.handoffTickets.resolve(openTicket.id, this.clock.now());
    }
  }
}

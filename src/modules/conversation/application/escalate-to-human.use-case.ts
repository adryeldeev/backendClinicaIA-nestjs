import { Injectable } from '@nestjs/common';
import { PrismaConversationRepository } from '../infrastructure/prisma-conversation.repository';
import { PrismaHandoffTicketRepository } from '../infrastructure/prisma-handoff-ticket.repository';

export interface EscalateToHumanInput {
  conversationId: string;
  reason: string;
  summary: string;
}

/**
 * Muda a conversa para AWAITING_HUMAN e registra o motivo. Chamado pela
 * tool `escalar_humano` (decisao do LLM), pelos guardrails de entrada/saida
 * (RN-01/RN-02/RN-03), por MAX_ITERATIONS e, a partir do achado do incidente
 * de 2026-09-23 (RN-16), por `llm_error_max_retries` quando o mesmo turno
 * falha por infra (llm_error) N vezes seguidas (LLM_ERROR_ESCALATION_THRESHOLD)
 * — ate esse limite, `llm_error` isolado NAO escala (ver
 * HandleDebouncedMessageUseCase, achado da Fase 3: falha transitoria unica
 * so deixa a mensagem pendente, pra sobreviver a um retry).
 */
@Injectable()
export class EscalateToHumanUseCase {
  constructor(
    private readonly conversations: PrismaConversationRepository,
    private readonly handoffTickets: PrismaHandoffTicketRepository,
  ) {}

  async execute(input: EscalateToHumanInput): Promise<void> {
    await this.conversations.escalateToHuman(input.conversationId);
    await this.handoffTickets.create(input.conversationId, input.reason, input.summary);
  }
}

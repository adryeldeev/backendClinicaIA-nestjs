import { Injectable } from '@nestjs/common';
import { PrismaConversationRepository } from '../infrastructure/prisma-conversation.repository';
import { PrismaHandoffTicketRepository } from '../infrastructure/prisma-handoff-ticket.repository';

export interface EscalationReasonCount {
  reason: string;
  quantidade: number;
}

export interface ConversationResolutionMetrics {
  totalConversas: number;
  concluidasSemEscalada: number;
  motivosDeEscalada: EscalationReasonCount[];
}

/**
 * GET /api/admin/metrics (fatia de conversation). "Concluida sem
 * escalada" = conversa iniciada no periodo que nunca gerou HandoffTicket
 * — resolvida pelo bot sozinho, independente do status atual.
 */
@Injectable()
export class GetConversationResolutionMetricsUseCase {
  constructor(
    private readonly conversations: PrismaConversationRepository,
    private readonly handoffTickets: PrismaHandoffTicketRepository,
  ) {}

  async execute(from: Date, to: Date): Promise<ConversationResolutionMetrics> {
    const [totalConversas, concluidasSemEscalada, reasonCounts] = await Promise.all([
      this.conversations.countInPeriod(from, to),
      this.conversations.countWithoutEscalationInPeriod(from, to),
      this.handoffTickets.countGroupedByReason(from, to),
    ]);

    return {
      totalConversas,
      concluidasSemEscalada,
      motivosDeEscalada: reasonCounts.map((row) => ({ reason: row.reason, quantidade: row.count })),
    };
  }
}

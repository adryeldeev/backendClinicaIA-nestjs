import { Injectable } from '@nestjs/common';
import { HandoffTicket } from '@prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';

@Injectable()
export class PrismaHandoffTicketRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(conversationId: string, reason: string, summary: string): Promise<HandoffTicket> {
    return this.prisma.handoffTicket.create({ data: { conversationId, reason, summary } });
  }

  /**
   * TakeoverConversationUseCase: fecha o ticket aberto (se existir) ao
   * assumir a conversa — achado da Fase 5/Etapa 1, nunca ninguem setava
   * `resolvedAt`. So o mais recente ainda aberto (uma conversa pode, em
   * tese, ter mais de um ticket historico).
   */
  findOpenByConversation(conversationId: string): Promise<HandoffTicket | null> {
    return this.prisma.handoffTicket.findFirst({
      where: { conversationId, resolvedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resolve(id: string, resolvedAt: Date): Promise<void> {
    await this.prisma.handoffTicket.update({ where: { id }, data: { resolvedAt } });
  }

  /**
   * RN-22 (expurgo por retencao): summary pode ter texto cru do paciente
   * quando reason e RN-01/RN-02 (checkInputGuardrail monta assim de
   * proposito, pro ticket ficar legivel pra um humano) — achado do
   * levantamento da Fase 5, a spec original nao cobria isso.
   */
  async redactSummaryForConversation(conversationId: string, marker: string): Promise<void> {
    await this.prisma.handoffTicket.updateMany({
      where: { conversationId },
      data: { summary: marker },
    });
  }

  /** GET /api/admin/metrics — motivos de escalada agrupados por quantidade no periodo. */
  async countGroupedByReason(from: Date, to: Date): Promise<Array<{ reason: string; count: number }>> {
    const rows = await this.prisma.handoffTicket.groupBy({
      by: ['reason'],
      where: { createdAt: { gte: from, lt: to } },
      _count: { _all: true },
    });
    return rows.map((row) => ({ reason: row.reason, count: row._count._all }));
  }
}

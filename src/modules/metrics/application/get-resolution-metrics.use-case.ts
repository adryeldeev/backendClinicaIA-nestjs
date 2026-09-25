import { Injectable } from '@nestjs/common';
import { GetAppointmentResolutionMetricsUseCase } from '../../scheduling';
import { GetConversationResolutionMetricsUseCase } from '../../conversation';

export interface ResolutionMetricsResult {
  periodo: { de: string; ate: string };
  conversas: {
    total: number;
    concluidasSemEscalada: number;
  };
  agendamentosPeloAgente: number;
  remarcacoesPeloAgente: number;
  cancelamentosPeloAgente: number;
  motivosDeEscalada: Array<{ motivo: string; quantidade: number }>;
}

/**
 * GET /api/admin/metrics (secao 5 da SPEC.md). So compoe: cada fatia vem
 * do caso de uso publico do modulo dono do dado (MM-01/03) —
 * GetConversationResolutionMetricsUseCase (Conversation + HandoffTicket) e
 * GetAppointmentResolutionMetricsUseCase (Appointment.createdBy). Nenhum
 * join direto entre tabelas de modulos diferentes.
 */
@Injectable()
export class GetResolutionMetricsUseCase {
  constructor(
    private readonly conversationMetrics: GetConversationResolutionMetricsUseCase,
    private readonly appointmentMetrics: GetAppointmentResolutionMetricsUseCase,
  ) {}

  async execute(from: Date, to: Date): Promise<ResolutionMetricsResult> {
    const [conversas, agendamentos] = await Promise.all([
      this.conversationMetrics.execute(from, to),
      this.appointmentMetrics.execute(from, to),
    ]);

    return {
      periodo: { de: from.toISOString(), ate: to.toISOString() },
      conversas: {
        total: conversas.totalConversas,
        concluidasSemEscalada: conversas.concluidasSemEscalada,
      },
      agendamentosPeloAgente: agendamentos.agendamentosPeloAgente,
      remarcacoesPeloAgente: agendamentos.remarcacoesPeloAgente,
      cancelamentosPeloAgente: agendamentos.cancelamentosPeloAgente,
      motivosDeEscalada: conversas.motivosDeEscalada.map((item) => ({
        motivo: item.reason,
        quantidade: item.quantidade,
      })),
    };
  }
}

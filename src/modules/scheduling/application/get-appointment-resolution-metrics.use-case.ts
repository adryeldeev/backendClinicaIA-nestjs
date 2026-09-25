import { Injectable } from '@nestjs/common';
import { PrismaAppointmentRepository } from '../infrastructure/prisma-appointment.repository';

export interface AppointmentResolutionMetrics {
  agendamentosPeloAgente: number;
  remarcacoesPeloAgente: number;
  cancelamentosPeloAgente: number;
}

/**
 * GET /api/admin/metrics (fatia de scheduling). Atribuicao por ORIGEM do
 * agendamento (Appointment.createdBy), nao por quem executou o
 * cancelamento/remarcacao depois — ver nota da secao 5 da SPEC.md.
 */
@Injectable()
export class GetAppointmentResolutionMetricsUseCase {
  constructor(private readonly appointments: PrismaAppointmentRepository) {}

  async execute(from: Date, to: Date): Promise<AppointmentResolutionMetrics> {
    const [agendamentosPeloAgente, remarcacoesPeloAgente, cancelamentosPeloAgente] = await Promise.all([
      this.appointments.countCreatedByInPeriod('agent', from, to),
      this.appointments.countReschedulesByInPeriod('agent', from, to),
      this.appointments.countCancellationsByInPeriod('agent', from, to),
    ]);

    return { agendamentosPeloAgente, remarcacoesPeloAgente, cancelamentosPeloAgente };
  }
}

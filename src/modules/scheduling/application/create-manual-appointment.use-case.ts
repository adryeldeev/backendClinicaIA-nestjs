import { Injectable } from '@nestjs/common';
import { ConfirmAppointmentUseCase } from './confirm-appointment.use-case';
import { HoldSlotUseCase } from './hold-slot.use-case';

export interface CreateManualAppointmentInput {
  professionalId: string;
  procedureId: string;
  patientId: string;
  startsAt: Date;
}

export interface CreateManualAppointmentResult {
  appointmentId: string;
}

/**
 * POST /api/admin/appointments (secao 5): "criacao manual, ja confirmada"
 * — a recepcao nao passa pelo TTL de 10min do hold (pensado pra paciente
 * decidindo por WhatsApp, nao pra quem esta com o paciente na sua frente
 * ou no telefone). Reaproveita HoldSlotUseCase (mesma validacao de
 * RN-04/05/06 e a mesma constraint de exclusao contra concorrencia) +
 * ConfirmAppointmentUseCase — so encadeia os dois, sem duplicar nenhuma
 * regra de agendamento.
 */
@Injectable()
export class CreateManualAppointmentUseCase {
  constructor(
    private readonly holdSlot: HoldSlotUseCase,
    private readonly confirmAppointment: ConfirmAppointmentUseCase,
  ) {}

  async execute(input: CreateManualAppointmentInput): Promise<CreateManualAppointmentResult> {
    const hold = await this.holdSlot.execute({ ...input, createdBy: 'human' });
    const confirmed = await this.confirmAppointment.execute(hold.appointmentId);
    return { appointmentId: confirmed.appointmentId };
  }
}

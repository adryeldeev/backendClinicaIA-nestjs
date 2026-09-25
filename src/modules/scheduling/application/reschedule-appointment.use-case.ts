import { Injectable } from '@nestjs/common';
import { AppointmentNotFoundError } from '../domain/errors/appointment-not-found.error';
import { NotAppointmentOwnerError } from '../domain/errors/not-appointment-owner.error';
import { PrismaAppointmentRepository } from '../infrastructure/prisma-appointment.repository';
import { ConfirmAppointmentUseCase } from './confirm-appointment.use-case';
import { HoldSlotUseCase } from './hold-slot.use-case';

export interface RescheduleAppointmentInput {
  appointmentId: string;
  patientId: string;
  newStartsAt: Date;
}

export interface RescheduleAppointmentResult {
  appointmentId: string;
}

/**
 * RN-13: saga com 3 passos. Se qualquer passo falhar, a consulta original
 * fica intacta — nada e desfeito porque nada e tocado fora de ordem:
 * so cancelamos a antiga depois que a nova ja esta CONFIRMED.
 */
@Injectable()
export class RescheduleAppointmentUseCase {
  constructor(
    private readonly appointments: PrismaAppointmentRepository,
    private readonly holdSlot: HoldSlotUseCase,
    private readonly confirmAppointment: ConfirmAppointmentUseCase,
  ) {}

  async execute(input: RescheduleAppointmentInput): Promise<RescheduleAppointmentResult> {
    const oldAppointment = await this.appointments.findById(input.appointmentId);
    if (!oldAppointment) {
      throw new AppointmentNotFoundError(input.appointmentId);
    }
    if (oldAppointment.patientId !== input.patientId) {
      throw new NotAppointmentOwnerError();
    }

    // 1. Reserva o novo horario (mesmo profissional e procedimento).
    //    Se falhar (SlotTakenError/InvalidSlotError), propaga direto — a
    //    consulta antiga nunca foi tocada.
    const hold = await this.holdSlot.execute({
      professionalId: oldAppointment.professionalId,
      procedureId: oldAppointment.procedureId,
      patientId: input.patientId,
      startsAt: input.newStartsAt,
      createdBy: 'agent',
    });

    // 2. Confirma o novo. Se falhar (HoldExpiredError), a antiga continua
    //    intacta — o hold novo, orfao, expira sozinho pelo job periodico.
    await this.confirmAppointment.execute(hold.appointmentId);

    // 3. So agora, com o novo ja CONFIRMED, cancela o antigo.
    //    lateCancellation fica false aqui: RN-12 e sobre desistencia do
    //    paciente, nao sobre a consulta ser substituida por outra.
    await this.appointments.cancel(oldAppointment.id, 'Remarcado', false);

    return { appointmentId: hold.appointmentId };
  }
}

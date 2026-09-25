import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../identity';
import { AppointmentNotFoundError } from '../domain/errors/appointment-not-found.error';
import { assertAppointmentInScope, resolveAppointmentScope } from '../domain/services/resolve-appointment-scope';
import { PrismaAppointmentRepository } from '../infrastructure/prisma-appointment.repository';
import { ConfirmAppointmentUseCase } from './confirm-appointment.use-case';
import { HoldSlotUseCase } from './hold-slot.use-case';

export interface AdminRescheduleAppointmentInput {
  appointmentId: string;
  newStartsAt: Date;
  currentUser: AuthenticatedUser;
}

export interface AdminRescheduleAppointmentResult {
  appointmentId: string;
}

/**
 * POST /api/admin/appointments/:id/reschedule — "mesma saga da secao 10"
 * (RN-13, 3 passos: reserva o novo, confirma, so entao cancela o antigo).
 * Igual RescheduleAppointmentUseCase, mas autoriza por escopo de
 * profissional (RBAC do painel) em vez de patientId (fluxo do agente).
 */
@Injectable()
export class AdminRescheduleAppointmentUseCase {
  constructor(
    private readonly appointments: PrismaAppointmentRepository,
    private readonly holdSlot: HoldSlotUseCase,
    private readonly confirmAppointment: ConfirmAppointmentUseCase,
  ) {}

  async execute(input: AdminRescheduleAppointmentInput): Promise<AdminRescheduleAppointmentResult> {
    const oldAppointment = await this.appointments.findById(input.appointmentId);
    if (!oldAppointment) {
      throw new AppointmentNotFoundError(input.appointmentId);
    }

    const scope = resolveAppointmentScope(input.currentUser);
    assertAppointmentInScope(scope, oldAppointment);

    const hold = await this.holdSlot.execute({
      professionalId: oldAppointment.professionalId,
      procedureId: oldAppointment.procedureId,
      patientId: oldAppointment.patientId,
      startsAt: input.newStartsAt,
      createdBy: 'human',
    });

    await this.confirmAppointment.execute(hold.appointmentId);

    await this.appointments.cancel(oldAppointment.id, 'Remarcado', false);

    return { appointmentId: hold.appointmentId };
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../shared/config/env.schema';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import type { AuthenticatedUser } from '../../identity';
import { AppointmentNotFoundError } from '../domain/errors/appointment-not-found.error';
import { assertAppointmentInScope, resolveAppointmentScope } from '../domain/services/resolve-appointment-scope';
import { PrismaAppointmentRepository } from '../infrastructure/prisma-appointment.repository';

const HOUR_MS = 60 * 60 * 1000;

export interface AdminCancelAppointmentInput {
  appointmentId: string;
  reason?: string;
  currentUser: AuthenticatedUser;
}

/**
 * POST /api/admin/appointments/:id/cancel (secao 5, papeis "todos" — mas
 * PROFISSIONAL so cancela consulta da propria agenda, mesma regra do
 * resolveAppointmentScope usado no list). Distinto de CancelAppointmentUseCase
 * (esse e do fluxo do agente via WhatsApp, autoriza por patientId — ator
 * diferente, regra de posse diferente).
 */
@Injectable()
export class AdminCancelAppointmentUseCase {
  constructor(
    private readonly appointments: PrismaAppointmentRepository,
    private readonly config: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(input: AdminCancelAppointmentInput): Promise<void> {
    const appointment = await this.appointments.findById(input.appointmentId);
    if (!appointment) {
      throw new AppointmentNotFoundError(input.appointmentId);
    }

    const scope = resolveAppointmentScope(input.currentUser);
    assertAppointmentInScope(scope, appointment);

    const lateCancelHours = this.config.get('LATE_CANCEL_HOURS', { infer: true });
    const hoursUntilAppointment = (appointment.startsAt.getTime() - this.clock.now().getTime()) / HOUR_MS;
    const lateCancellation = hoursUntilAppointment < lateCancelHours;

    await this.appointments.cancel(appointment.id, input.reason, lateCancellation);
  }
}

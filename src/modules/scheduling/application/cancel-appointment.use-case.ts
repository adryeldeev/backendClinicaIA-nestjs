import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../shared/config/env.schema';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { AppointmentNotFoundError } from '../domain/errors/appointment-not-found.error';
import { NotAppointmentOwnerError } from '../domain/errors/not-appointment-owner.error';
import { PrismaAppointmentRepository } from '../infrastructure/prisma-appointment.repository';

const HOUR_MS = 60 * 60 * 1000;

export interface CancelAppointmentInput {
  appointmentId: string;
  // Vem sempre do contexto do servidor, nunca do que o LLM enviou.
  patientId: string;
  reason?: string;
}

@Injectable()
export class CancelAppointmentUseCase {
  constructor(
    private readonly appointments: PrismaAppointmentRepository,
    private readonly config: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(input: CancelAppointmentInput): Promise<void> {
    const appointment = await this.appointments.findById(input.appointmentId);
    if (!appointment) {
      throw new AppointmentNotFoundError(input.appointmentId);
    }

    // RN-14: verificacao no servico, nao no prompt.
    if (appointment.patientId !== input.patientId) {
      throw new NotAppointmentOwnerError();
    }

    const lateCancelHours = this.config.get('LATE_CANCEL_HOURS', { infer: true });
    const hoursUntilAppointment = (appointment.startsAt.getTime() - this.clock.now().getTime()) / HOUR_MS;
    const lateCancellation = hoursUntilAppointment < lateCancelHours;

    await this.appointments.cancel(appointment.id, input.reason, lateCancellation);
  }
}

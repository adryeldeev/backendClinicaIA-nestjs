import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { PrismaAppointmentRepository } from '../infrastructure/prisma-appointment.repository';

const HOUR_MS = 60 * 60 * 1000;
const REMINDER_LEAD_HOURS = 24;

export interface AppointmentReminderDto {
  appointmentId: string;
  patientPhoneE164: string;
  professionalName: string;
  procedureName: string;
  startsAt: Date;
}

/**
 * Fase 5: consultas confirmadas cujo horario cai dentro da janela de
 * lembrete de 24h. `windowSizeMs` deve bater com o intervalo do job que
 * chama isto (ver SendAppointmentReminderJob) — a janela cobre exatamente
 * um tick, sem lacuna, e `reminderSentAt` (checado no repositorio) evita
 * duplicar se dois ticks acabarem se sobrepondo.
 */
@Injectable()
export class ListAppointmentsNeedingReminderUseCase {
  constructor(
    private readonly appointments: PrismaAppointmentRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(windowSizeMs: number): Promise<AppointmentReminderDto[]> {
    const now = this.clock.now();
    const windowStart = new Date(now.getTime() + REMINDER_LEAD_HOURS * HOUR_MS);
    const windowEnd = new Date(windowStart.getTime() + windowSizeMs);

    const appointments = await this.appointments.findConfirmedNeedingReminder(windowStart, windowEnd);

    return appointments.map((appointment) => ({
      appointmentId: appointment.id,
      patientPhoneE164: appointment.patient.phoneE164,
      professionalName: appointment.professional.name,
      procedureName: appointment.procedure.name,
      startsAt: appointment.startsAt,
    }));
  }
}

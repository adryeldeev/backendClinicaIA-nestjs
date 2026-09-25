import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { PrismaAppointmentRepository } from '../infrastructure/prisma-appointment.repository';

@Injectable()
export class MarkReminderSentUseCase {
  constructor(
    private readonly appointments: PrismaAppointmentRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(appointmentId: string): Promise<void> {
    await this.appointments.markReminderSent(appointmentId, this.clock.now());
  }
}

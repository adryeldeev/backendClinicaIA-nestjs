import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { PrismaAppointmentRepository } from '../infrastructure/prisma-appointment.repository';

export interface PatientAppointmentDto {
  id: string;
  professionalName: string;
  startsAt: Date;
  status: string;
}

/** Tool `consultar_minhas_consultas` (secao 9 da SPEC.md). */
@Injectable()
export class ListPatientAppointmentsUseCase {
  constructor(
    private readonly appointments: PrismaAppointmentRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(patientId: string): Promise<PatientAppointmentDto[]> {
    const appointments = await this.appointments.findUpcomingConfirmedByPatient(patientId, this.clock.now());
    return appointments.map((appointment) => ({
      id: appointment.id,
      professionalName: appointment.professional.name,
      startsAt: appointment.startsAt,
      status: appointment.status,
    }));
  }
}

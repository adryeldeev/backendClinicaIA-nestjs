import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { AppointmentWithProfessional, PrismaAppointmentRepository } from '../infrastructure/prisma-appointment.repository';

export interface PatientAppointmentHistory {
  upcoming: AppointmentWithProfessional[];
  past: AppointmentWithProfessional[];
}

/**
 * GET /api/admin/patients/:id/appointments (achado do usuario, 2026-09-25).
 * Servido por `scheduling`, dono de `Appointment` — MM-03 ao pe da letra:
 * o modulo dono do dado serve a rota, mesmo com o caminho HTTP comecando
 * em `/patients` (dono e `conversation`). Nao existe aresta nova entre os
 * dois modulos por causa disso: o front bate na URL, nao importa qual
 * controller/modulo atende. Nao checa se `patientId` existe de verdade —
 * scheduling nao e dono de Patient; um id inexistente simplesmente nao
 * bate nenhum Appointment, devolve listas vazias. O front ja checou a
 * existencia via GET /patients/:id (que sim, 404 se nao existir) antes de
 * chegar aqui.
 */
@Injectable()
export class ListPatientAppointmentHistoryUseCase {
  constructor(
    private readonly appointments: PrismaAppointmentRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(patientId: string): Promise<PatientAppointmentHistory> {
    // findAllByPatient ordena startsAt DESC — bom pra "past" (mais recente
    // primeiro), invertido pra "upcoming" (mais proxima primeiro faz mais
    // sentido pra recepcao decidir o que vem a seguir).
    const all = await this.appointments.findAllByPatient(patientId);
    const now = this.clock.now().getTime();
    const upcoming = all.filter((appointment) => appointment.startsAt.getTime() > now).reverse();
    const past = all.filter((appointment) => appointment.startsAt.getTime() <= now);
    return { upcoming, past };
  }
}

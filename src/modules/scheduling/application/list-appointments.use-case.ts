import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../identity';
import { resolveAppointmentScope } from '../domain/services/resolve-appointment-scope';
import { AppointmentWithProfessional, PrismaAppointmentRepository } from '../infrastructure/prisma-appointment.repository';

export interface ListAppointmentsInput {
  from: Date;
  to: Date;
  requestedProfessionalId?: string;
  currentUser: AuthenticatedUser;
}

/**
 * GET /api/admin/appointments (secao 5). O controller nunca decide sozinho
 * qual agenda o usuario pode ver — sempre passa por resolveAppointmentScope
 * aqui, pra nao duplicar essa regra em cada rota que precisar dela.
 */
@Injectable()
export class ListAppointmentsUseCase {
  constructor(private readonly appointments: PrismaAppointmentRepository) {}

  execute(input: ListAppointmentsInput): Promise<AppointmentWithProfessional[]> {
    const scope = resolveAppointmentScope(input.currentUser, input.requestedProfessionalId);
    return this.appointments.listByRange({ from: input.from, to: input.to }, scope);
  }
}

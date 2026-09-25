import { Inject, Injectable } from '@nestjs/common';
import { Appointment, Procedure } from '@prisma/client';
import { ManageProceduresUseCase, type UpdateProcedureInput as CatalogUpdateProcedureInput } from '../../catalog';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { PrismaAppointmentRepository } from '../infrastructure/prisma-appointment.repository';

export interface UpdateProcedureResult {
  procedure: Procedure;
  /** So preenchido quando `active` vira false — mesmo espirito de UpdateProfessionalUseCase. */
  affectedAppointments: Appointment[];
}

/**
 * Mesma razao de UpdateProfessionalUseCase existir em scheduling: mudar
 * `durationMin` (Caso 2) NUNCA precisa disto — ManageProceduresUseCase.update
 * so grava o campo, e Appointment.startsAt/endsAt de consultas ja marcadas
 * nunca sao recalculados a partir do procedimento. So `active:false`
 * (Caso 1) precisa olhar consulta futura.
 */
@Injectable()
export class UpdateProcedureUseCase {
  constructor(
    private readonly manageProcedures: ManageProceduresUseCase,
    private readonly appointments: PrismaAppointmentRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(input: CatalogUpdateProcedureInput): Promise<UpdateProcedureResult> {
    const procedure = await this.manageProcedures.update(input);

    const affectedAppointments =
      input.active === false
        ? await this.appointments.listFutureConfirmedByProcedure(input.id, this.clock.now())
        : [];

    return { procedure, affectedAppointments };
  }
}

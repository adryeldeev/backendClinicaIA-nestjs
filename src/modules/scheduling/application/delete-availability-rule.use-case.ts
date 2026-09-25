import { Inject, Injectable } from '@nestjs/common';
import { Appointment } from '@prisma/client';
import { DateTime } from 'luxon';
import { GetProfessionalUseCase, ManageAvailabilityUseCase } from '../../catalog';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { PrismaAppointmentRepository } from '../infrastructure/prisma-appointment.repository';

export interface DeleteAvailabilityRuleResult {
  /**
   * Toda consulta confirmada futura no mesmo dia da semana da regra
   * removida — conservador de proposito: nao verifica se OUTRA regra do
   * mesmo profissional/dia ainda cobre o horario (turno partido), pra nao
   * arriscar um falso negativo. Mesma limitacao assumida de
   * UpdateAvailabilityRuleUseCase.
   */
  affectedAppointments: Appointment[];
}

@Injectable()
export class DeleteAvailabilityRuleUseCase {
  constructor(
    private readonly manageAvailability: ManageAvailabilityUseCase,
    private readonly getProfessional: GetProfessionalUseCase,
    private readonly appointments: PrismaAppointmentRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ruleId: string): Promise<DeleteAvailabilityRuleResult> {
    const existingRule = await this.manageAvailability.getRule(ruleId);
    const professional = await this.getProfessional.execute(existingRule.professionalId);

    const futureConfirmed = await this.appointments.listFutureConfirmedByProfessional(
      existingRule.professionalId,
      this.clock.now(),
    );
    const affectedAppointments = futureConfirmed.filter(
      (appointment) =>
        DateTime.fromJSDate(appointment.startsAt, { zone: 'utc' }).setZone(professional.clinicTimezone).weekday % 7 ===
        existingRule.weekday,
    );

    await this.manageAvailability.deleteRule(ruleId);

    return { affectedAppointments };
  }
}

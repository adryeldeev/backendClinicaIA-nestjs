import { Inject, Injectable } from '@nestjs/common';
import { Appointment, AvailabilityRule } from '@prisma/client';
import { DateTime } from 'luxon';
import { GetProfessionalUseCase, ManageAvailabilityUseCase, type UpdateAvailabilityRuleInput } from '../../catalog';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { findAppointmentsOutsideWindow } from '../domain/services/find-appointments-outside-window';
import { PrismaAppointmentRepository } from '../infrastructure/prisma-appointment.repository';

export interface UpdateAvailabilityRuleResult {
  rule: AvailabilityRule;
  /**
   * Caso 3 do plano da Etapa 3: consultas confirmadas futuras, no mesmo
   * dia da semana da regra, que ficaram fora da janela NOVA (startTime/
   * endTime). Continuam CONFIRMED, nunca movidas nem canceladas — so
   * informadas.
   */
  affectedAppointments: Appointment[];
}

function localWeekday(date: Date, timezone: string): number {
  return DateTime.fromJSDate(date, { zone: 'utc' }).setZone(timezone).weekday % 7;
}

/**
 * Wrapper em scheduling pelo mesmo motivo de UpdateProfessionalUseCase:
 * catalog nao pode depender de scheduling, mas o aviso de impacto precisa
 * ler Appointment. Limitacao assumida: se o profissional tiver MAIS de
 * uma AvailabilityRule pro mesmo dia da semana (turno partido), uma
 * consulta coberta por OUTRA regra pode aparecer aqui como "fora da
 * janela" (falso positivo) — a comparacao e sempre contra a regra que
 * esta sendo editada, nao contra a uniao de todas as regras do dia. Nao
 * implementado por nao ter sido pedido; aceito por avisar demais ser
 * preferivel a nao avisar (mesmo principio do Caso 3).
 */
@Injectable()
export class UpdateAvailabilityRuleUseCase {
  constructor(
    private readonly manageAvailability: ManageAvailabilityUseCase,
    private readonly getProfessional: GetProfessionalUseCase,
    private readonly appointments: PrismaAppointmentRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(input: UpdateAvailabilityRuleInput): Promise<UpdateAvailabilityRuleResult> {
    const existingRule = await this.manageAvailability.getRule(input.id);
    const updatedRule = await this.manageAvailability.updateRule(input);

    const professional = await this.getProfessional.execute(existingRule.professionalId);
    const futureConfirmed = await this.appointments.listFutureConfirmedByProfessional(
      existingRule.professionalId,
      this.clock.now(),
    );

    const sameWeekday = futureConfirmed.filter(
      (appointment) => localWeekday(appointment.startsAt, professional.clinicTimezone) === updatedRule.weekday,
    );

    const outsideIds = new Set(
      findAppointmentsOutsideWindow(
        sameWeekday.map((appointment) => ({ id: appointment.id, startsAt: appointment.startsAt, endsAt: appointment.endsAt })),
        { startTime: updatedRule.startTime, endTime: updatedRule.endTime },
        professional.clinicTimezone,
      ).map((appointment) => appointment.id),
    );

    return {
      rule: updatedRule,
      affectedAppointments: sameWeekday.filter((appointment) => outsideIds.has(appointment.id)),
    };
  }
}

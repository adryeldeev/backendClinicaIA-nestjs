import { Injectable } from '@nestjs/common';
import { CandidateSlot, generateCandidateSlots } from '../domain/services/slot-generator';
import { ProfessionalNotFoundError } from '../domain/errors/professional-not-found.error';
import { PrismaCatalogRepository } from '../infrastructure/prisma-catalog.repository';
import { GetProcedureUseCase } from './get-procedure.use-case';

export interface ListAvailableSlotsInput {
  professionalId: string;
  procedureId: string;
  fromUtc: Date;
  toUtc: Date;
}

/**
 * Retorna os slots que a AGENDA do profissional permite (RN-06: existe
 * AvailabilityRule cobrindo, nao ha AvailabilityException bloqueante),
 * com a duracao do procedimento pedido — nao a do grid da regra. Nao sabe
 * se algum desses slots ja esta ocupado por um Appointment — isso e
 * responsabilidade do scheduling, que chama este caso de uso como insumo
 * (ver scheduling/application/list-open-slots.use-case.ts).
 *
 * Achado na Etapa 3 (Fase 6): profissional/procedimento desativado nao
 * bloqueava novo agendamento — nada aqui checava `active`. HoldSlotUseCase
 * e CreateManualAppointmentUseCase passam OS DOIS por este metodo, entao
 * corrigir aqui bloqueia novo agendamento nos dois fluxos de uma vez, sem
 * duplicar a checagem.
 */
@Injectable()
export class ListAvailableSlotsUseCase {
  constructor(
    private readonly catalog: PrismaCatalogRepository,
    private readonly getProcedure: GetProcedureUseCase,
  ) {}

  async execute(input: ListAvailableSlotsInput): Promise<CandidateSlot[]> {
    const [professional, procedure] = await Promise.all([
      this.catalog.findProfessionalWithClinic(input.professionalId),
      this.getProcedure.execute(input.procedureId),
    ]);
    if (!professional) {
      throw new ProfessionalNotFoundError(input.professionalId);
    }

    if (!professional.active || !procedure.active) {
      return [];
    }

    const [rules, exceptions] = await Promise.all([
      this.catalog.listAvailabilityRules(input.professionalId),
      this.catalog.listAvailabilityExceptions(input.professionalId, input.fromUtc, input.toUtc),
    ]);

    return generateCandidateSlots({
      rules,
      exceptions,
      timezone: professional.clinic.timezone,
      fromUtc: input.fromUtc,
      toUtc: input.toUtc,
      slotDurationMinutes: procedure.durationMin,
    });
  }
}

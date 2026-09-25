import { DomainError } from '../../../../shared/kernel/domain-error';

/**
 * Traduz a violacao da constraint de exclusao appointment_no_overlap
 * (23P01 do Postgres, PrismaClientUnknownRequestError — capturado no
 * repositorio) para um erro de dominio. Ver decisao 2 do plano da Fase 2 —
 * Anti-Corruption Layer na fronteira infrastructure -> domain.
 */
export class SlotTakenError extends DomainError {
  readonly code = 'SLOT_TAKEN';
  readonly httpStatus = 409;

  constructor() {
    super('Esse horário acabou de ser ocupado.');
  }
}

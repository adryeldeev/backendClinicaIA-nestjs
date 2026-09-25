import { DomainError } from '../../../../shared/kernel/domain-error';

/** So deveria acontecer se o banco nunca foi semeado (nenhuma Clinic criada). */
export class ClinicNotFoundError extends DomainError {
  readonly code = 'CLINIC_NOT_FOUND';
  readonly httpStatus = 404;

  constructor() {
    super('Nenhuma clínica cadastrada.');
  }
}

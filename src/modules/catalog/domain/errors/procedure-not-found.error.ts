import { DomainError } from '../../../../shared/kernel/domain-error';

export class ProcedureNotFoundError extends DomainError {
  readonly code = 'PROCEDURE_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(procedureId: string) {
    super(`Procedimento ${procedureId} não encontrado.`);
  }
}

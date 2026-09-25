import { DomainError } from '../../../../shared/kernel/domain-error';

export class AvailabilityExceptionNotFoundError extends DomainError {
  readonly code = 'AVAILABILITY_EXCEPTION_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(exceptionId: string) {
    super(`Exceção de disponibilidade ${exceptionId} não encontrada.`);
  }
}

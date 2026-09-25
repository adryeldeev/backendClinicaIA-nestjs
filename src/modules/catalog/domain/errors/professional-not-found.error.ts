import { DomainError } from '../../../../shared/kernel/domain-error';

export class ProfessionalNotFoundError extends DomainError {
  readonly code = 'PROFESSIONAL_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(professionalId: string) {
    super(`Profissional ${professionalId} não encontrado.`);
  }
}

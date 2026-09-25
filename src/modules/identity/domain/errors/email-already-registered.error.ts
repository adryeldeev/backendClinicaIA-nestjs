import { DomainError } from '../../../../shared/kernel/domain-error';

export class EmailAlreadyRegisteredError extends DomainError {
  readonly code = 'EMAIL_ALREADY_REGISTERED';
  readonly httpStatus = 409;

  constructor(email: string) {
    super(`Já existe um usuário com o e-mail ${email}.`);
  }
}

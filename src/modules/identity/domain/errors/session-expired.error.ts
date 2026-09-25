import { DomainError } from '../../../../shared/kernel/domain-error';

/** Cookie ausente, adulterado, sessao revogada ou expirada — mesmo tratamento pro cliente. */
export class SessionExpiredError extends DomainError {
  readonly code = 'SESSION_EXPIRED';
  readonly httpStatus = 401;

  constructor() {
    super('Sessão inválida ou expirada. Faça login novamente.');
  }
}

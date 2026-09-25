import { DomainError } from '../../../../shared/kernel/domain-error';

/** SEC-08: 5 tentativas / 15 min / IP. */
export class LoginRateLimitedError extends DomainError {
  readonly code = 'LOGIN_RATE_LIMITED';
  readonly httpStatus = 429;

  constructor() {
    super('Muitas tentativas de login. Tente novamente mais tarde.');
  }
}

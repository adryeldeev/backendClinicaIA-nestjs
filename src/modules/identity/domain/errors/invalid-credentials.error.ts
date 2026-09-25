import { DomainError } from '../../../../shared/kernel/domain-error';

/**
 * Mensagem generica de proposito — nao diferencia "email nao existe" de
 * "senha errada", pra nao dar dica de enumeracao de usuario a quem tenta
 * adivinhar.
 */
export class InvalidCredentialsError extends DomainError {
  readonly code = 'INVALID_CREDENTIALS';
  readonly httpStatus = 401;

  constructor() {
    super('E-mail ou senha inválidos.');
  }
}

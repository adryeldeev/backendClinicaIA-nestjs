import { DomainError } from '../../../../shared/kernel/domain-error';

export class InvalidConversationTransitionError extends DomainError {
  readonly code = 'INVALID_CONVERSATION_TRANSITION';
  readonly httpStatus = 409;

  constructor(from: string, expectedFrom: string) {
    super(`Não é possível fazer essa transição a partir de ${from} (esperado: ${expectedFrom}).`);
  }
}

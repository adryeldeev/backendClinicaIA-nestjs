import { DomainError } from '../../../../shared/kernel/domain-error';

/** Evita duas trocas atomicas (activateVersion) correndo por cima uma da outra pro mesmo sourceRef. */
export class ReindexAlreadyPendingError extends DomainError {
  readonly code = 'REINDEX_ALREADY_PENDING';
  readonly httpStatus = 409;

  constructor() {
    super('Já existe uma reindexação pendente ou em andamento para este documento.');
  }
}

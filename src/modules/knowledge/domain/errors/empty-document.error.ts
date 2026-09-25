import { DomainError } from '../../../../shared/kernel/domain-error';

export class EmptyDocumentError extends DomainError {
  readonly code = 'EMPTY_DOCUMENT';
  readonly httpStatus = 400;

  constructor() {
    super('Documento vazio — nada para ingerir.');
  }
}

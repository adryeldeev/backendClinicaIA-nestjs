import { DomainError } from '../../../../shared/kernel/domain-error';

export class KnowledgeDocumentNotFoundError extends DomainError {
  readonly code = 'KNOWLEDGE_DOCUMENT_NOT_FOUND';
  readonly httpStatus = 404;

  constructor() {
    super('Documento de conhecimento não encontrado.');
  }
}

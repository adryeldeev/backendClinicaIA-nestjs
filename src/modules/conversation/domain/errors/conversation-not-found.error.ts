import { DomainError } from '../../../../shared/kernel/domain-error';

export class ConversationNotFoundError extends DomainError {
  readonly code = 'CONVERSATION_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(conversationId: string) {
    super(`Conversa ${conversationId} não encontrada.`);
  }
}

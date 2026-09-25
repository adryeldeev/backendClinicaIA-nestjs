export { ConversationModule } from './conversation.module';
export {
  GetOrCreateConversationUseCase,
  type GetOrCreateConversationResult,
} from './application/get-or-create-conversation.use-case';
export {
  RecordInboundMessageUseCase,
  type RecordInboundMessageInput,
} from './application/record-inbound-message.use-case';
export {
  HandleDebouncedMessageUseCase,
  type HandleDebouncedMessageResult,
} from './application/handle-debounced-message.use-case';
export {
  GetConversationWindowUseCase,
  type ConversationWindowResult,
} from './application/get-conversation-window.use-case';
export { FindStuckConversationsUseCase } from './application/find-stuck-conversations.use-case';
export { EnsureHumanAssignedUseCase } from './application/ensure-human-assigned.use-case';
export { RecordHumanMessageUseCase } from './application/record-human-message.use-case';
export { RecordAgentReplyUseCase } from './application/record-agent-reply.use-case';
export {
  GetConversationDetailUseCase,
  type ConversationDetail,
} from './application/get-conversation-detail.use-case';
export {
  ListConversationsUseCase,
  type ListConversationsInput,
  type ListConversationsResult,
} from './application/list-conversations.use-case';
export { SearchConversationsUseCase } from './application/search-conversations.use-case';
export { ConversationNotFoundError } from './domain/errors/conversation-not-found.error';
export {
  GetConversationResolutionMetricsUseCase,
  type ConversationResolutionMetrics,
  type EscalationReasonCount,
} from './application/get-conversation-resolution-metrics.use-case';

export const INBOUND_MESSAGES_QUEUE = 'inbound-messages';
export const OUTBOX_QUEUE = 'outbox';
export const SCHEDULING_MAINTENANCE_QUEUE = 'scheduling-maintenance';
export const APPOINTMENT_REMINDER_QUEUE = 'appointment-reminder';
export const CONVERSATION_PURGE_QUEUE = 'conversation-purge';
export const REPROCESS_STUCK_TURNS_QUEUE = 'reprocess-stuck-turns';
export const KNOWLEDGE_REINDEX_QUEUE = 'knowledge-reindex';

export const EXPIRE_HOLDS_JOB_ID = 'expire-holds';
export const SEND_APPOINTMENT_REMINDER_JOB_ID = 'send-appointment-reminder';
export const PURGE_CONVERSATIONS_JOB_ID = 'purge-conversations';
export const REPROCESS_STUCK_TURNS_JOB_ID = 'reprocess-stuck-turns';

// BullMQ nao aceita ":" em jobId customizado (usa internamente como
// separador de chave no Redis) — por isso "-" em vez de ":" aqui.
export function inboundJobId(conversationId: string): string {
  return `inbound-${conversationId}`;
}

export function outboxJobId(outboxMessageId: string): string {
  return `outbox-${outboxMessageId}`;
}

export function knowledgeReindexJobId(documentId: string): string {
  return `knowledge-reindex-${documentId}`;
}

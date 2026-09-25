import { Injectable } from '@nestjs/common';
import { ConversationStatus } from '@prisma/client';
import { ConversationListItem, PrismaConversationRepository } from '../infrastructure/prisma-conversation.repository';
import { decodeCursorOrThrow } from './decode-cursor-or-throw';

export interface ListConversationsInput {
  statuses?: ConversationStatus[];
  limit: number;
  cursor?: string;
}

export interface ListConversationsResult {
  items: ConversationListItem[];
  nextCursor: string | null;
}

/**
 * GET /api/admin/conversations?status=&limit=&cursor= — contrato da Fase 1
 * (divergencias #1/#2/#3). MUDANCA DE CONTRATO (2026-09-24, ver SPEC.md
 * secao 5): sem `status`, devolve TODAS as conversas (antes: so
 * AWAITING_HUMAN por default) — front e o unico consumidor e esta sendo
 * reescrito, sem risco pratico de quebra.
 */
@Injectable()
export class ListConversationsUseCase {
  constructor(private readonly conversations: PrismaConversationRepository) {}

  execute(input: ListConversationsInput): Promise<ListConversationsResult> {
    const cursor = decodeCursorOrThrow(input.cursor);
    return this.conversations.listByStatuses(input.statuses ?? null, input.limit, cursor);
  }
}

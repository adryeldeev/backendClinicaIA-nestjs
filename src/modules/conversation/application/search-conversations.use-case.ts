import { Injectable } from '@nestjs/common';
import { ConversationListItem, PrismaConversationRepository } from '../infrastructure/prisma-conversation.repository';
import { decodeCursorOrThrow } from './decode-cursor-or-throw';

export interface SearchConversationsInput {
  query: string;
  limit: number;
  cursor?: string;
}

export interface SearchConversationsResult {
  items: ConversationListItem[];
  nextCursor: string | null;
}

/**
 * POST /api/admin/conversations/search — corpo, nunca query string
 * (SEC-07). Busca por nome/telefone do paciente. Alinhado ao contrato da
 * listagem (achado do usuario, 2026-09-24): `{items, nextCursor}`, `limit`
 * opcional (padrao/teto do servidor, ver controller), cada item no mesmo
 * formato do item da lista — inclusive `lastMessage`. Antes devolvia array
 * puro sem paginacao; o front nao deveria se adaptar a esse formato
 * antigo, a mudanca e daqui.
 */
@Injectable()
export class SearchConversationsUseCase {
  constructor(private readonly conversations: PrismaConversationRepository) {}

  execute(input: SearchConversationsInput): Promise<SearchConversationsResult> {
    const cursor = decodeCursorOrThrow(input.cursor);
    return this.conversations.searchByPatient(input.query, input.limit, cursor);
  }
}

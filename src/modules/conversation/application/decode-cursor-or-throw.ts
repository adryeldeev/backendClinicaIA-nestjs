import { BadRequestException } from '@nestjs/common';
import { ConversationCursor, decodeConversationCursor } from '../infrastructure/prisma-conversation.repository';

/**
 * Extraido de ListConversationsUseCase pro alinhamento da busca reusar o
 * mesmo tratamento — cursor opaco/malformado e entrada invalida do
 * cliente, nao erro interno (400, nao 500).
 */
export function decodeCursorOrThrow(raw?: string): ConversationCursor | undefined {
  try {
    return raw ? decodeConversationCursor(raw) : undefined;
  } catch {
    throw new BadRequestException(`Cursor inválido: "${raw}"`);
  }
}

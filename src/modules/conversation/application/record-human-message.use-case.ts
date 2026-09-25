import { Injectable } from '@nestjs/common';
import { Message, MessageRole } from '@prisma/client';
import { PrismaMessageRepository } from '../infrastructure/prisma-message.repository';

/**
 * Registra o que um humano do painel mandou — pra aparecer no historico da
 * conversa (GetConversationDetailUseCase). `outboxMessageId` e obrigatorio
 * (contrato da Fase 1, correcao 2): o outbox e criado ANTES desta chamada,
 * pelo caller (SendAdminMessageUseCase) — nunca o contrario. `authorUserId`
 * identifica QUEM mandou (achado do front: "duas recepcionistas" so
 * aparece na tela se a mensagem souber de quem e).
 */
@Injectable()
export class RecordHumanMessageUseCase {
  constructor(private readonly messages: PrismaMessageRepository) {}

  execute(conversationId: string, content: string, authorUserId: string, outboxMessageId: string): Promise<Message> {
    return this.messages.create({ conversationId, role: MessageRole.HUMAN, content, authorUserId, outboxMessageId });
  }
}

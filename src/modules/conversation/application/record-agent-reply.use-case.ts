import { Injectable } from '@nestjs/common';
import { Message, MessageRole } from '@prisma/client';
import { PrismaMessageRepository } from '../infrastructure/prisma-message.repository';

/**
 * Registra a resposta do agente DEPOIS que o OutboxMessage ja existe —
 * chamado por ProcessInboundJob (messaging) apos criar o outbox, nunca
 * antes (contrato da Fase 1, correcao 2 do usuario: criar a Message antes
 * do outbox existir deixaria uma janela em que um crash no meio faria a
 * resposta parecer enviada no historico sem nunca ter sido enfileirada).
 */
@Injectable()
export class RecordAgentReplyUseCase {
  constructor(private readonly messages: PrismaMessageRepository) {}

  execute(conversationId: string, content: string, outboxMessageId: string): Promise<Message> {
    return this.messages.create({ conversationId, role: MessageRole.AGENT, content, outboxMessageId });
  }
}

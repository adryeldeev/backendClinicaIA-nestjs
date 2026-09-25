import { Inject, Injectable } from '@nestjs/common';
import { ConversationStatus, Message, MessageRole } from '@prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';

/**
 * Achado do usuario (2026-09-24): `toolCalls` carrega identificador
 * interno e o raciocinio do modelo (SEC-02) — nunca deveria alcancar o
 * navegador, mesmo que hoje nenhum codigo escreva valor nele (coluna
 * sempre null na pratica). `Omit<Message, 'toolCalls'>` narra o `omit`
 * de verdade aplicado em `listAllByConversation` abaixo.
 */
export type MessageWithDelivery = Omit<Message, 'toolCalls'> & {
  outboxMessage: { status: string; sentAt: Date | null; lastError: string | null } | null;
  authorUser: { id: string; name: string } | null;
};

@Injectable()
export class PrismaMessageRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Achado na varredura do contrato da Fase 1 (mesma classe do bug do
   * AuditLog.createdAt): `Message.createdAt` tinha so `@default(now())` no
   * schema (relogio REAL do Postgres) enquanto RN-16
   * (findConversationIdsWithStuckMessages) decide reprocessamento
   * comparando esse valor contra um cutoff derivado do Clock injetado.
   * Sempre estampado aqui a partir do Clock — `createdAt` explicito no
   * input (usado por fixture de teste que precisa de um instante passado
   * especifico) tem prioridade sobre `clock.now()`.
   *
   * Tambem estampa `Conversation.lastActivityAt` (RN-22, mesmo instante da
   * Message) — QUALQUER mensagem, nao so PATIENT, conta como atividade
   * real. Numa transacao: as duas escritas ou acontecem juntas ou nenhuma.
   */
  async create(input: {
    conversationId: string;
    role: MessageRole;
    content: string;
    externalId?: string;
    authorUserId?: string;
    outboxMessageId?: string;
    createdAt?: Date;
  }): Promise<Message> {
    const timestamp = input.createdAt ?? this.clock.now();
    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId: input.conversationId,
          role: input.role,
          content: input.content,
          externalId: input.externalId,
          authorUserId: input.authorUserId,
          createdAt: timestamp,
          outboxMessageId: input.outboxMessageId,
        },
      }),
      this.prisma.conversation.update({
        where: { id: input.conversationId },
        data: { lastActivityAt: timestamp },
      }),
    ]);
    return message;
  }

  findLatestByRole(conversationId: string, role: MessageRole): Promise<Message | null> {
    return this.prisma.message.findFirst({
      where: { conversationId, role },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Mensagens do paciente que ainda nao entraram em nenhum turno do
   * orquestrador (Fase 3, decisao 1 do plano) — TODAS, nao so a ultima.
   */
  findUnconsumedPatientMessages(conversationId: string): Promise<Message[]> {
    return this.prisma.message.findMany({
      where: { conversationId, role: MessageRole.PATIENT, consumedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async markConsumed(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) {
      return;
    }
    await this.prisma.message.updateMany({
      where: { id: { in: messageIds } },
      data: { consumedAt: new Date() },
    });
  }

  /**
   * RN-22 (expurgo por retencao): sobrescreve o conteudo com um marcador
   * fixo — preserva role/createdAt/id (a FORMA da conversa, util pra
   * auditoria estrutural) sem reter o conteudo clinico em si.
   */
  async redactContent(conversationId: string, marker: string): Promise<void> {
    await this.prisma.message.updateMany({
      where: { conversationId },
      data: { content: marker },
    });
  }

  /**
   * RN-16 (job varredor): conversas em BOT com mensagem de paciente ainda
   * nao consumida ha mais de `olderThan` — o caso classico e llm_error
   * (Fase 3: nao marca consumido nem escala, de proposito, pra sobreviver
   * a um retry) quando o proprio paciente nunca manda outra mensagem pra
   * disparar um novo turno sozinho. So BOT: HUMAN/AWAITING_HUMAN/CLOSED ja
   * tem outro tratamento (humano cuidando, ou expurgada).
   */
  async findConversationIdsWithStuckMessages(olderThan: Date): Promise<string[]> {
    const stuck = await this.prisma.message.findMany({
      where: {
        role: MessageRole.PATIENT,
        consumedAt: null,
        createdAt: { lt: olderThan },
        conversation: { status: ConversationStatus.BOT },
      },
      distinct: ['conversationId'],
      select: { conversationId: true },
    });
    return stuck.map((message) => message.conversationId);
  }

  /**
   * GET /api/admin/conversations/:id — historico completo, cronologico, sem
   * excluir nada. Inclui status de entrega (via outboxMessage — contrato da
   * Fase 1, divergencia #5) e quem mandou, quando for HUMAN (autorUser).
   */
  listAllByConversation(conversationId: string): Promise<MessageWithDelivery[]> {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: {
        outboxMessage: { select: { status: true, sentAt: true, lastError: true } },
        authorUser: { select: { id: true, name: true } },
      },
      omit: { toolCalls: true },
    });
  }

  /**
   * Historico de turnos ja fechados, mais recentes primeiro na query e
   * devolvidos em ordem cronologica. Exclui mensagens do paciente ainda
   * nao consumidas — essas sao o turno atual, passadas separadamente.
   */
  async findRecentHistory(conversationId: string, limit: number): Promise<Message[]> {
    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        NOT: { role: MessageRole.PATIENT, consumedAt: null },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return messages.reverse();
  }
}

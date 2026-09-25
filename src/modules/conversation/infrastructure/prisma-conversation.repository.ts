import { Inject, Injectable } from '@nestjs/common';
import { Conversation, ConversationStatus, Patient, Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';

type AssignedUserSummary = { id: string; name: string } | null;

/**
 * Achado do usuario (2026-09-24): `context` (dados coletados parciais do
 * paciente, SEC-02) nunca e lido em lugar nenhum do codigo — so escrito
 * (create com valor default, markPurged zerando) — mas ainda assim
 * trafegava pro navegador em toda resposta admin que usa este tipo,
 * porque `include` devolve TODOS os campos escalares do model base, nao
 * so as relacoes. `Omit<Conversation, 'context'>` aqui reflete o `omit`
 * de verdade aplicado nas queries abaixo — tipo e runtime narrados juntos,
 * nao so o tipo prometendo algo que a query nao entrega mais.
 */
export type ConversationWithPatient = Omit<Conversation, 'context'> & {
  patient: Patient;
  assignedUser: AssignedUserSummary;
};

/**
 * Item da lista do painel (GET /api/admin/conversations) — inclui a ULTIMA
 * mensagem (com status de entrega) numa unica query, sem N+1 (Prisma
 * resolve `messages: {take:1,...}` dentro de `include` com uma query
 * batched por lote de pais, nao uma por conversa). Contrato da Fase 1,
 * divergencia #1.
 */
export type ConversationListItem = ConversationWithPatient & {
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: Date;
    outboxMessage: { status: string } | null;
  }>;
};

export interface ConversationCursor {
  updatedAt: Date;
  id: string;
}

/** Cursor opaco composto por (updatedAt, id) — ver correcao 1 do usuario: updatedAt sozinho nao e unico. */
export function encodeConversationCursor(cursor: ConversationCursor): string {
  return Buffer.from(`${cursor.updatedAt.toISOString()}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeConversationCursor(raw: string): ConversationCursor {
  const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const updatedAt = new Date(iso);
  if (!id || Number.isNaN(updatedAt.getTime())) {
    throw new Error(`Cursor inválido: "${raw}"`);
  }
  return { updatedAt, id };
}

const CONVERSATION_LIST_INCLUDE = {
  patient: true,
  assignedUser: { select: { id: true, name: true } },
} as const;

@Injectable()
export class PrismaConversationRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  findOpenByPatientId(patientId: string): Promise<Conversation | null> {
    return this.prisma.conversation.findFirst({
      where: { patientId, status: { not: ConversationStatus.CLOSED } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** lastActivityAt nasce com a criacao — a propria conversa comecar a existir ja e a primeira atividade (RN-22). */
  create(patientId: string): Promise<Conversation> {
    return this.prisma.conversation.create({ data: { patientId, lastActivityAt: this.clock.now() } });
  }

  findByIdWithPatient(id: string): Promise<ConversationWithPatient | null> {
    return this.prisma.conversation.findUnique({
      where: { id },
      include: CONVERSATION_LIST_INCLUDE,
      omit: { context: true },
    });
  }

  /**
   * GET /api/admin/conversations?status=&limit=&cursor= (contrato da Fase
   * 1, divergencias #1/#2/#3 — MUDANCA DE CONTRATO em relacao ao endpoint
   * anterior, ver SPEC.md secao 5: sem `status`, devolve TODAS as
   * conversas, nao so AWAITING_HUMAN; `limit` agora obrigatorio.
   * Paginacao por keyset em (updatedAt DESC, id DESC) — updatedAt sozinho
   * muda de valor a qualquer mensagem nova, entao o par com `id` e o que
   * garante um cursor estavel (correcao 1 do usuario). Isso significa que
   * um item PODE mudar de pagina entre duas chamadas se a conversa dele
   * receber mensagem nova no meio da rolagem — aceitavel pra caixa de
   * entrada (RN documentado na SPEC.md), mas real.
   */
  listByStatuses(
    statuses: ConversationStatus[] | null,
    limit: number,
    cursor?: ConversationCursor,
  ): Promise<{ items: ConversationListItem[]; nextCursor: string | null }> {
    return this.findPaginated(statuses ? { status: { in: statuses } } : {}, limit, cursor);
  }

  /**
   * POST /api/admin/conversations/search — SEC-07 (corpo, nunca query
   * string). Busca por identidade do paciente (nome/telefone), mesmo
   * padrao de PrismaPatientRepository.search. Alinhado ao mesmo contrato
   * de listByStatuses (achado do usuario, 2026-09-24: a busca nao seguia o
   * formato da listagem — `{items, nextCursor}`, `limit` opcional,
   * `lastMessage` por item — front tinha que tratar como um formato
   * diferente sem necessidade real).
   */
  searchByPatient(
    query: string,
    limit: number,
    cursor?: ConversationCursor,
  ): Promise<{ items: ConversationListItem[]; nextCursor: string | null }> {
    return this.findPaginated(
      { patient: { OR: [{ name: { contains: query, mode: 'insensitive' } }, { phoneE164: { contains: query } }] } },
      limit,
      cursor,
    );
  }

  /**
   * Nucleo compartilhado por listByStatuses/searchByPatient — mesma
   * paginacao por keyset, mesmo include (ultima mensagem sem N+1), mesmo
   * omit de `context` (SEC-02). `where` combina com a clausula do cursor
   * via `AND` (nao spread direto) porque `where` do chamador ja pode ter
   * seu proprio `OR` (caso da busca por paciente) — sobrescrever em vez de
   * combinar apagaria silenciosamente um dos dois filtros.
   */
  private async findPaginated(
    where: Prisma.ConversationWhereInput,
    limit: number,
    cursor?: ConversationCursor,
  ): Promise<{ items: ConversationListItem[]; nextCursor: string | null }> {
    const rows = await this.prisma.conversation.findMany({
      where: {
        AND: [
          where,
          ...(cursor
            ? [
                {
                  OR: [
                    { updatedAt: { lt: cursor.updatedAt } },
                    { updatedAt: cursor.updatedAt, id: { lt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      include: {
        ...CONVERSATION_LIST_INCLUDE,
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
            outboxMessage: { select: { status: true } },
          },
        },
      },
      omit: { context: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeConversationCursor({ updatedAt: last.updatedAt, id: last.id }) : null;

    return { items, nextCursor };
  }

  /**
   * Quem do painel esta cuidando desta conversa (contrato da Fase 1,
   * divergencia #6) — setado no takeover (explicito ou implicito via
   * RN-26), limpo (`null`) no release.
   */
  setAssignedUser(id: string, userId: string | null): Promise<Conversation> {
    return this.prisma.conversation.update({ where: { id }, data: { assignedUserId: userId } });
  }

  markInbound(id: string, lastInboundAt: Date, windowExpiresAt: Date): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id },
      data: { lastInboundAt, windowExpiresAt },
    });
  }

  escalateToHuman(id: string): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id },
      data: { status: ConversationStatus.AWAITING_HUMAN },
    });
  }

  /** RN-16: turno terminou em llm_error — incrementa e devolve o novo total, atomico. */
  async incrementConsecutiveLlmErrors(id: string): Promise<number> {
    const updated = await this.prisma.conversation.update({
      where: { id },
      data: { consecutiveLlmErrors: { increment: 1 } },
      select: { consecutiveLlmErrors: true },
    });
    return updated.consecutiveLlmErrors;
  }

  /** RN-16: turno terminou em qualquer outra coisa (resposta ou escalada por outro motivo) — zera o contador. */
  async resetConsecutiveLlmErrors(id: string): Promise<void> {
    await this.prisma.conversation.update({
      where: { id },
      data: { consecutiveLlmErrors: 0 },
    });
  }

  setStatus(id: string, status: ConversationStatus): Promise<Conversation> {
    return this.prisma.conversation.update({ where: { id }, data: { status } });
  }

  /**
   * RN-22: candidatas ao expurgo — `lastActivityAt` (nunca `updatedAt`,
   * ver comentario no schema) antes do corte de retencao e ainda nao
   * fechadas por expurgo (status != CLOSED evita reprocessar uma conversa
   * ja expurgada em todo tick do job).
   */
  findStaleConversations(cutoff: Date): Promise<Conversation[]> {
    return this.prisma.conversation.findMany({
      where: {
        status: { not: ConversationStatus.CLOSED },
        lastActivityAt: { lt: cutoff },
      },
    });
  }

  /** RN-22: fecha e limpa `context` (Json com dados coletados parciais — pode ter nome/preferencia do paciente). */
  markPurged(id: string): Promise<Conversation> {
    return this.prisma.conversation.update({
      where: { id },
      data: { status: ConversationStatus.CLOSED, context: {} },
    });
  }

  /** GET /api/admin/metrics — total de conversas iniciadas no periodo. */
  countInPeriod(from: Date, to: Date): Promise<number> {
    return this.prisma.conversation.count({ where: { createdAt: { gte: from, lt: to } } });
  }

  /**
   * GET /api/admin/metrics — "concluida sem escalada" = nunca gerou
   * HandoffTicket. Sem relacao Prisma entre Conversation e HandoffTicket
   * (nenhum @relation declarado no schema), NOT EXISTS via SQL cru evita
   * carregar um array grande de ids so pra um `notIn`.
   */
  async countWithoutEscalationInPeriod(from: Date, to: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count
      FROM "Conversation" c
      WHERE c."createdAt" >= ${from} AND c."createdAt" < ${to}
        AND NOT EXISTS (SELECT 1 FROM "HandoffTicket" h WHERE h."conversationId" = c.id)
    `;
    return Number(rows[0]?.count ?? 0);
  }
}

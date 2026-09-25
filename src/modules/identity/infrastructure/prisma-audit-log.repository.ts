import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';

export interface AuditLogInput {
  actorType: 'user' | 'agent' | 'system';
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip: string | null;
}

@Injectable()
export class PrismaAuditLogRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * SEC-10 (achado do front, contrato da Fase 1): suporta a deduplicacao do
   * AuditService — "ja existe um evento igual (mesmo ator/entidade/acao)
   * dentro da janela?" antes de gravar. Indice composto dedicado em
   * AuditLog evita sequenciar a tabela a cada leitura auditada.
   */
  async findRecentMatch(
    actorId: string | null,
    entityType: string,
    entityId: string,
    action: string,
    since: Date,
  ): Promise<{ id: string } | null> {
    return this.prisma.auditLog.findFirst({
      where: { actorId, entityType, entityId, action, createdAt: { gte: since } },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(input: AuditLogInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before === undefined ? undefined : (input.before as object),
        after: input.after === undefined ? undefined : (input.after as object),
        ip: input.ip,
        // Achado no contrato da Fase 1 (item F): o dedup do AuditService
        // compara createdAt contra um cutoff derivado do Clock injetado —
        // deixar createdAt no @default(now()) do schema (relogio REAL do
        // Postgres) quebra a comparacao sob FixedClock (teste avançava o
        // clock pra Janeiro, mas a linha continuava carimbada com a data
        // real de execucao). Mesma regra ja documentada no CLAUDE.md: nada
        // que decide por tempo usa relogio direto, sempre o Clock injetado.
        createdAt: this.clock.now(),
      },
    });
  }
}

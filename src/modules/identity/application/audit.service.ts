import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../shared/config/env.schema';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { AuditLogInput, PrismaAuditLogRepository } from '../infrastructure/prisma-audit-log.repository';

const SECOND_MS = 1000;

/**
 * SEC-10 (achado do front, contrato da Fase 1, item F): o painel faz
 * polling de ~5s por conversa aberta — sem isso, uma sessao de 10 minutos
 * olhando a mesma conversa gerava ~120 linhas de AuditLog indistinguiveis
 * de 120 aberturas reais (~11 mil linhas/dia/recepcionista), o que
 * esvaziava o valor probatorio da auditoria (LGPD pede rastreabilidade de
 * EVENTO de acesso, nao de requisicao HTTP). Dentro de
 * AUDIT_DEDUP_WINDOW_SECONDS, o mesmo (ator, entidade, acao) nao gera uma
 * 2a linha — a linha original ja e a evidencia de "quando comecou a
 * olhar". Reabrir a mesma conversa depois da janela gera uma linha NOVA
 * (evento de acesso distinto, nao ruido).
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly auditLogs: PrismaAuditLogRepository,
    private readonly config: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async record(input: AuditLogInput): Promise<void> {
    const windowSeconds = this.config.get('AUDIT_DEDUP_WINDOW_SECONDS', { infer: true });
    const since = new Date(this.clock.now().getTime() - windowSeconds * SECOND_MS);

    const existing = await this.auditLogs.findRecentMatch(
      input.actorId,
      input.entityType,
      input.entityId,
      input.action,
      since,
    );
    if (existing) {
      return;
    }

    await this.auditLogs.create(input);
  }
}

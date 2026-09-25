import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import type { Env } from '../../../shared/config/env.schema';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { CONVERSATION_PURGE_QUEUE } from '../../../shared/queue/queue.tokens';
import { PrismaConversationRepository } from '../infrastructure/prisma-conversation.repository';
import { PrismaHandoffTicketRepository } from '../infrastructure/prisma-handoff-ticket.repository';
import { PrismaMessageRepository } from '../infrastructure/prisma-message.repository';

const DAY_MS = 24 * 60 * 60 * 1000;

// RN-22: so o CONTEUDO da conversa expurga. Appointment/Patient nunca sao
// tocados aqui — regra de guarda de atendimento clinico e completamente
// diferente (achado do plano da Fase 5, a spec original nao separava
// isso). Anonimiza (marcador fixo), nunca deleta a linha — preserva a
// forma da conversa (role/createdAt/id) pra auditoria estrutural.
const REDACTION_MARKER = '[conteudo expurgado apos CONVERSATION_RETENTION_DAYS — RN-22]';

/**
 * Job periodico (mesmo padrao do ExpireHoldsJob): conversas com ultima
 * atividade alem de CONVERSATION_RETENTION_DAYS tem o conteudo anonimizado
 * e ficam CLOSED. HandoffTicket.summary de tickets ligados tambem e
 * redigido — pode ter texto cru do paciente (guardrail de entrada monta
 * assim de proposito).
 */
@Processor(CONVERSATION_PURGE_QUEUE)
export class PurgeConversationsJob extends WorkerHost {
  private readonly logger = new Logger(PurgeConversationsJob.name);

  constructor(
    private readonly conversations: PrismaConversationRepository,
    private readonly messages: PrismaMessageRepository,
    private readonly handoffTickets: PrismaHandoffTicketRepository,
    private readonly config: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    // Flag destrutiva, padrao desligada (ver env.schema.ts) — achado do
    // incidente de 2026-09-23: um ambiente de dev nunca deveria redigir
    // conversa de verdade so por a aplicacao ter subido.
    if (!this.config.get('RETENTION_PURGE_ENABLED', { infer: true })) {
      this.logger.debug('Expurgo por retencao (RN-22) desabilitado (RETENTION_PURGE_ENABLED=false) — nada foi tocado.');
      return;
    }

    const retentionDays = this.config.get('CONVERSATION_RETENTION_DAYS', { infer: true });
    const cutoff = new Date(this.clock.now().getTime() - retentionDays * DAY_MS);

    const stale = await this.conversations.findStaleConversations(cutoff);

    for (const conversation of stale) {
      await this.messages.redactContent(conversation.id, REDACTION_MARKER);
      await this.handoffTickets.redactSummaryForConversation(conversation.id, REDACTION_MARKER);
      await this.conversations.markPurged(conversation.id);
    }

    if (stale.length > 0) {
      this.logger.log(`${stale.length} conversa(s) expurgada(s) por retencao (RN-22).`);
    }
  }
}

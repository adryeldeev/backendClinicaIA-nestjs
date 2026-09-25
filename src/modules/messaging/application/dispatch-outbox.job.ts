import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { GetConversationWindowUseCase } from '../../conversation';
import type { Env } from '../../../shared/config/env.schema';
import { OUTBOX_QUEUE } from '../../../shared/queue/queue.tokens';
import { CLOCK, Clock } from '../../../shared/kernel/clock';
import { redactForLog } from '../../../shared/kernel/redact-pii';
import { PrismaOutboxRepository } from '../infrastructure/prisma-outbox.repository';
import { MESSAGING_PORT, MessagingPort } from '../ports/messaging.port';

export interface DispatchOutboxJobData {
  outboxMessageId: string;
}

@Processor(OUTBOX_QUEUE)
export class DispatchOutboxJob extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(DispatchOutboxJob.name);

  constructor(
    private readonly outbox: PrismaOutboxRepository,
    @Inject(MESSAGING_PORT) private readonly messagingPort: MessagingPort,
    private readonly getConversationWindow: GetConversationWindowUseCase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  /** Ver comentario espelhado em ProcessInboundJob.onApplicationBootstrap — mesmo mecanismo, mesma razao. */
  onApplicationBootstrap(): void {
    this.worker.concurrency = this.config.get('OUTBOX_QUEUE_CONCURRENCY', { infer: true });
  }

  async process(job: Job<DispatchOutboxJobData>): Promise<void> {
    const outboxMessage = await this.outbox.findById(job.data.outboxMessageId);
    if (!outboxMessage) {
      throw new Error(`OutboxMessage ${job.data.outboxMessageId} nao encontrado`);
    }

    // RN-18: template sempre pode ser enviado (e o proprio mecanismo pra
    // furar a janela de 24h). Texto livre precisa da janela aberta —
    // recusa direto, sem tentar e sem retry, se ja expirou: nao e falha
    // transitoria, e regra de negocio determinística.
    if (!outboxMessage.templateName) {
      const window = await this.getConversationWindow.execute(outboxMessage.toPhoneE164);
      const windowExpired = !window?.windowExpiresAt || window.windowExpiresAt.getTime() <= this.clock.now().getTime();
      if (windowExpired) {
        await this.outbox.markFailed(
          outboxMessage.id,
          'window_expired: janela de 24h do WhatsApp encerrada, texto livre recusado (RN-18)',
        );
        return;
      }
    }

    // Achado do front (contrato da Fase 1, acrescimo 1): sem isso, ninguem
    // consegue testar o caminho completo de envio sem risco de mandar
    // WhatsApp REAL pra um dos poucos numeros de teste da Meta. Desligado
    // (padrao), NAO chama a Cloud API — RN-18 acima ja rodou de verdade, so
    // a entrega em si e pulada.
    //
    // Achado do usuario (2026-09-24): marcar SENT aqui era dado falso — o
    // painel mostrava "entregue" pra mensagem que nunca saiu de verdade.
    // SKIPPED deixa claro que o dispatch foi pulado por configuracao, nao
    // que a Cloud API aceitou.
    if (!this.config.get('OUTBOX_DISPATCH_ENABLED', { infer: true })) {
      this.logger.log(
        `OUTBOX_DISPATCH_ENABLED=false — pulando envio pra ${redactForLog(outboxMessage.toPhoneE164)} em vez de chamar a WhatsApp Cloud API.`,
      );
      await this.outbox.markSkipped(outboxMessage.id);
      return;
    }

    try {
      if (outboxMessage.templateName) {
        await this.messagingPort.sendTemplate(
          outboxMessage.toPhoneE164,
          outboxMessage.templateName,
          (outboxMessage.templateArgs as string[] | null) ?? [],
        );
      } else {
        await this.messagingPort.sendText(outboxMessage.toPhoneE164, outboxMessage.body);
      }
      await this.outbox.markSent(outboxMessage.id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.outbox.markAttemptFailed(outboxMessage.id, reason);

      // job.attemptsMade so e incrementado APOS uma falha ser processada
      // pelo BullMQ — durante a proria tentativa, ele ainda reflete as
      // tentativas ANTERIORES (mesma convencao usada internamente pelo
      // BullMQ em Job#shouldRetryJob: "vai tentar de novo" = attemptsMade+1 < attempts).
      const attemptsLimit = job.opts.attempts ?? 1;
      const isLastAttempt = job.attemptsMade + 1 >= attemptsLimit;
      if (isLastAttempt) {
        await this.outbox.markFailed(outboxMessage.id, reason);
      }

      throw error;
    }
  }
}

import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { HandleDebouncedMessageUseCase, RecordAgentReplyUseCase } from '../../conversation';
import type { Env } from '../../../shared/config/env.schema';
import { OUTBOX_QUEUE, outboxJobId } from '../../../shared/queue/queue.tokens';
import { INBOUND_MESSAGES_QUEUE } from '../../../shared/queue/queue.tokens';
import { PrismaOutboxRepository } from '../infrastructure/prisma-outbox.repository';

export interface ProcessInboundJobData {
  conversationId: string;
}

// Exportadas para os testes de exaustao de retry poderem calcular o
// tempo de espera esperado sem duplicar esses numeros.
export const OUTBOX_ATTEMPTS = 5;
export const OUTBOX_BACKOFF_DELAY_MS = 1000;

@Processor(INBOUND_MESSAGES_QUEUE)
export class ProcessInboundJob extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly handleDebouncedMessage: HandleDebouncedMessageUseCase,
    private readonly recordAgentReply: RecordAgentReplyUseCase,
    private readonly outbox: PrismaOutboxRepository,
    @InjectQueue(OUTBOX_QUEUE) private readonly outboxQueue: Queue,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  /**
   * Achado do usuario (2026-09-24): concorrencia do BullMQ e 1 por padrao,
   * e o `@Processor(...)` decorator (onde a opcao normalmente entraria) e
   * avaliado no IMPORT do modulo — antes do ConfigModule carregar o .env,
   * confirmado na pratica ao tentar ler `process.env` la direto (so
   * enxerga variavel de ambiente REAL do shell, nunca `.env`, mesma classe
   * de armadilha de timing ja documentada no CLAUDE.md pra migration vs.
   * codigo). `this.worker` so existe depois do `onModuleInit` (o proprio
   * WorkerHost lanca erro explicito se acessado antes) — `onApplicationBootstrap`
   * roda depois disso e ja tem `ConfigService` totalmente resolvido via DI.
   */
  onApplicationBootstrap(): void {
    this.worker.concurrency = this.config.get('INBOUND_QUEUE_CONCURRENCY', { infer: true });
  }

  async process(job: Job<ProcessInboundJobData>): Promise<void> {
    const result = await this.handleDebouncedMessage.execute(job.data.conversationId);
    if (result.skipped) {
      return;
    }

    // Outbox PRIMEIRO, Message DEPOIS com o id ja em maos (contrato da Fase
    // 1, correcao 2 do usuario): se o processo morrer entre os dois, o
    // outbox ja existe e SERA despachado — o pior caso e a Message nao
    // aparecer no historico, nunca uma resposta "fantasma" que nunca sai.
    const outboxMessage = await this.outbox.create(result.patientPhoneE164, result.reply);
    await this.recordAgentReply.execute(job.data.conversationId, result.reply, outboxMessage.id);

    await this.outboxQueue.add(
      OUTBOX_QUEUE,
      { outboxMessageId: outboxMessage.id },
      {
        jobId: outboxJobId(outboxMessage.id),
        attempts: OUTBOX_ATTEMPTS,
        backoff: { type: 'exponential', delay: OUTBOX_BACKOFF_DELAY_MS },
        removeOnComplete: true,
      },
    );
  }
}

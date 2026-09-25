import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { FindStuckConversationsUseCase } from '../../conversation';
import type { Env } from '../../../shared/config/env.schema';
import {
  INBOUND_MESSAGES_QUEUE,
  REPROCESS_STUCK_TURNS_QUEUE,
  inboundJobId,
} from '../../../shared/queue/queue.tokens';

// Precisa ser >= o proprio intervalo do job (senao a mesma conversa
// poderia ser pega de novo antes do reprocessamento anterior sequer
// começar). 10min: espaçado o suficiente sem deixar o paciente esperando muito.
export const REPROCESS_CHECK_INTERVAL_MS = 10 * 60 * 1000;

/**
 * RN-16 (job varredor, achado no teste manual da Fase 3 — registrado na
 * SPEC.md secao 12): mensagem de paciente presa por llm_error (falha
 * transitoria de LLM, ja depois de esgotar retry+fallback) so e
 * reprocessada se o proprio paciente mandar outra mensagem. Sem isso, um
 * paciente que nao insiste fica sem resposta pra sempre — o pior desfecho
 * possivel numa instabilidade momentanea do provedor.
 *
 * Teto de reprocessamento (achado do incidente de 2026-09-23): sem ele,
 * numa instabilidade sustentada do provedor este job reenfileirava a mesma
 * conversa a cada tick pra sempre, queimando cota indefinidamente sem nunca
 * escalar. HandleDebouncedMessageUseCase conta turnos CONSECUTIVOS que
 * terminam em llm_error (`Conversation.consecutiveLlmErrors`) e escala pra
 * humano ao atingir LLM_ERROR_ESCALATION_THRESHOLD — este job so enfileira,
 * quem decide reprocessar-de-novo-ou-escalar e o handler do outro lado.
 */
@Processor(REPROCESS_STUCK_TURNS_QUEUE)
export class ReprocessStuckTurnsJob extends WorkerHost {
  private readonly logger = new Logger(ReprocessStuckTurnsJob.name);

  constructor(
    private readonly findStuckConversations: FindStuckConversationsUseCase,
    @InjectQueue(INBOUND_MESSAGES_QUEUE) private readonly inboundQueue: Queue,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const stuckAfterMinutes = this.config.get('STUCK_MESSAGE_REPROCESS_MINUTES', { infer: true });
    const conversationIds = await this.findStuckConversations.execute(stuckAfterMinutes);

    for (const conversationId of conversationIds) {
      // jobId deterministico por conversa (mesmo padrao do debounce em
      // receive-webhook.use-case.ts) — se ja houver um job pendente pra
      // essa conversa (ex.: o paciente mandou mensagem nova nesse meio
      // tempo), o BullMQ ignora silenciosamente esta segunda tentativa de
      // add com o mesmo jobId, sem duplicar processamento.
      await this.inboundQueue.add(
        INBOUND_MESSAGES_QUEUE,
        { conversationId },
        { jobId: inboundJobId(conversationId), removeOnComplete: true, removeOnFail: true },
      );
    }

    if (conversationIds.length > 0) {
      this.logger.warn(`${conversationIds.length} conversa(s) presa(s) por llm_error reenfileirada(s) (RN-16).`);
    }
  }
}

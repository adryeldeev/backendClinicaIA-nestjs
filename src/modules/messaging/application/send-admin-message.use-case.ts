import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EnsureHumanAssignedUseCase, GetConversationDetailUseCase, RecordHumanMessageUseCase } from '../../conversation';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { OUTBOX_QUEUE, outboxJobId } from '../../../shared/queue/queue.tokens';
import { WindowExpiredError } from '../domain/errors/window-expired.error';
import { PrismaOutboxRepository } from '../infrastructure/prisma-outbox.repository';
import { OUTBOX_ATTEMPTS, OUTBOX_BACKOFF_DELAY_MS } from './process-inbound.job';

export interface SendAdminMessageInput {
  conversationId: string;
  body: string;
  userId: string;
}

export interface SendAdminMessageResult {
  outboxMessageId: string;
}

/**
 * POST /api/admin/conversations/:id/messages. Mora em messaging (nao em
 * conversation) porque e dono do outbox — decisao 2 do plano da Etapa 1:
 * conversation nao pode depender de messaging (grafo so permite
 * messaging -> conversation), entao esse endpoint especifico fica aqui,
 * mesmo a rota logicamente "pertencendo" a conversation.
 *
 * RN-18 checado SINCRONAMENTE aqui (janela expirada -> 409 na hora pro
 * admin) — diferente de DispatchOutboxJob, que so descobre isso depois
 * de ja ter enfileirado (marca FAILED sem tentar enviar). RN-26
 * (assuncao implicita) via EnsureHumanAssignedUseCase antes de enfileirar.
 */
@Injectable()
export class SendAdminMessageUseCase {
  constructor(
    private readonly getConversationDetail: GetConversationDetailUseCase,
    private readonly ensureHumanAssigned: EnsureHumanAssignedUseCase,
    private readonly recordHumanMessage: RecordHumanMessageUseCase,
    private readonly outbox: PrismaOutboxRepository,
    @InjectQueue(OUTBOX_QUEUE) private readonly outboxQueue: Queue,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(input: SendAdminMessageInput): Promise<SendAdminMessageResult> {
    const { conversation } = await this.getConversationDetail.execute(input.conversationId);

    const windowExpired =
      !conversation.windowExpiresAt || conversation.windowExpiresAt.getTime() <= this.clock.now().getTime();
    if (windowExpired) {
      throw new WindowExpiredError();
    }

    await this.ensureHumanAssigned.execute(input.conversationId, input.userId);

    // Outbox PRIMEIRO, Message DEPOIS com o id ja em maos (contrato da Fase
    // 1, correcao 2 do usuario) — mesmo motivo do caminho do agente em
    // ProcessInboundJob: nunca deixar uma Message existir sem o outbox que
    // a entrega ja ter sido criado.
    const outboxMessage = await this.outbox.create(conversation.patient.phoneE164, input.body);
    await this.recordHumanMessage.execute(input.conversationId, input.body, input.userId, outboxMessage.id);

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

    return { outboxMessageId: outboxMessage.id };
  }
}

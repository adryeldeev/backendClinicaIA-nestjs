import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { Env } from '../../../shared/config/env.schema';
import { INBOUND_MESSAGES_QUEUE, inboundJobId } from '../../../shared/queue/queue.tokens';
import {
  GetOrCreateConversationUseCase,
  RecordInboundMessageUseCase,
} from '../../conversation';
import { InvalidSignatureError } from '../domain/errors/invalid-signature.error';
import { extractInboundMessages, WhatsappWebhookPayload } from '../domain/whatsapp-webhook-payload';
import { isValidMetaSignature } from '../domain/verify-signature';
import { PrismaInboundEventRepository } from '../infrastructure/prisma-inbound-event.repository';

@Injectable()
export class ReceiveWebhookUseCase {
  private readonly logger = new Logger(ReceiveWebhookUseCase.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly inboundEvents: PrismaInboundEventRepository,
    private readonly getOrCreateConversation: GetOrCreateConversationUseCase,
    private readonly recordInboundMessage: RecordInboundMessageUseCase,
    @InjectQueue(INBOUND_MESSAGES_QUEUE) private readonly inboundQueue: Queue,
  ) {}

  verifySignature(rawBody: Buffer, signatureHeader: string | undefined): void {
    const appSecret = this.config.get('WHATSAPP_APP_SECRET', { infer: true });
    if (!isValidMetaSignature(rawBody, signatureHeader, appSecret)) {
      throw new InvalidSignatureError();
    }
  }

  async execute(payload: WhatsappWebhookPayload): Promise<void> {
    const messages = extractInboundMessages(payload);

    for (const message of messages) {
      const isNew = await this.inboundEvents.tryRegister(message.wamid, payload as never);
      if (!isNew) {
        this.logger.log(`wamid ${message.wamid} ja processado — descartando (idempotencia).`);
        continue;
      }

      const { conversationId } = await this.getOrCreateConversation.execute(message.fromPhoneE164);

      // RN-17: tipos != texto ainda nao tem tratamento de guardrail (Fase 5);
      // por ora registramos um marcador para nao quebrar o pipeline nem perder o evento.
      const content = message.text ?? `[mensagem do tipo '${message.type}' nao suportada nesta fase]`;

      await this.recordInboundMessage.execute({
        conversationId,
        content,
        externalId: message.wamid,
      });

      // "Processado" aqui significa "capturado de forma duravel" — nao tem
      // relacao com a resposta que sera gerada depois (essa parte e
      // colapsada pelo debounce, ver handle-debounced-message.use-case.ts).
      await this.inboundEvents.markProcessed(message.wamid);

      await this.scheduleDebounce(conversationId);
    }
  }

  private async scheduleDebounce(conversationId: string): Promise<void> {
    const jobId = inboundJobId(conversationId);
    const existing = await this.inboundQueue.getJob(jobId);
    if (existing) {
      try {
        await existing.remove();
      } catch (error) {
        // Job ja ativo (em processamento) nao pode ser removido — tudo bem,
        // o handler le a ultima Message do banco, entao a mensagem mais
        // recente ainda sera considerada quando ele rodar.
        this.logger.debug(`Nao foi possivel cancelar job ${jobId} (provavelmente ja ativo): ${error}`);
      }
    }

    await this.inboundQueue.add(
      INBOUND_MESSAGES_QUEUE,
      { conversationId },
      {
        jobId,
        delay: this.config.get('MESSAGE_DEBOUNCE_MS', { infer: true }),
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}

import { InjectQueue } from '@nestjs/bullmq';
import { Module, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConversationModule } from '../conversation';
import { IdentityModule } from '../identity';
import { SchedulingModule } from '../scheduling';
import { CLOCK, SystemClock } from '../../shared/kernel/clock';
import { QueueModule } from '../../shared/queue/bullmq.module';
import { registerRepeatableJob } from '../../shared/queue/register-repeatable-job';
import {
  APPOINTMENT_REMINDER_QUEUE,
  REPROCESS_STUCK_TURNS_JOB_ID,
  REPROCESS_STUCK_TURNS_QUEUE,
  SEND_APPOINTMENT_REMINDER_JOB_ID,
} from '../../shared/queue/queue.tokens';
import { AdminMessagesAdminController } from './interface/admin-messages.admin-controller';
import { DispatchOutboxJob } from './application/dispatch-outbox.job';
import { ProcessInboundJob } from './application/process-inbound.job';
import { ReceiveWebhookUseCase } from './application/receive-webhook.use-case';
import { REPROCESS_CHECK_INTERVAL_MS, ReprocessStuckTurnsJob } from './application/reprocess-stuck-turns.job';
import { SendAdminMessageUseCase } from './application/send-admin-message.use-case';
import { REMINDER_CHECK_INTERVAL_MS, SendAppointmentReminderJob } from './application/send-appointment-reminder.job';
import { PrismaInboundEventRepository } from './infrastructure/prisma-inbound-event.repository';
import { PrismaOutboxRepository } from './infrastructure/prisma-outbox.repository';
import { WhatsappCloudAdapter } from './infrastructure/whatsapp-cloud.adapter';
import { WhatsappWebhookController } from './interface/whatsapp.webhook-controller';
import { MESSAGING_PORT } from './ports/messaging.port';

@Module({
  imports: [ConversationModule, SchedulingModule, QueueModule, IdentityModule],
  controllers: [WhatsappWebhookController, AdminMessagesAdminController],
  providers: [
    ReceiveWebhookUseCase,
    ProcessInboundJob,
    DispatchOutboxJob,
    SendAppointmentReminderJob,
    ReprocessStuckTurnsJob,
    SendAdminMessageUseCase,
    PrismaInboundEventRepository,
    PrismaOutboxRepository,
    { provide: MESSAGING_PORT, useClass: WhatsappCloudAdapter },
    { provide: CLOCK, useClass: SystemClock },
  ],
})
export class MessagingModule implements OnModuleInit {
  constructor(
    @InjectQueue(APPOINTMENT_REMINDER_QUEUE) private readonly reminderQueue: Queue,
    @InjectQueue(REPROCESS_STUCK_TURNS_QUEUE) private readonly reprocessQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    // A mais importante das quatro filas repetiveis (achado do usuario,
    // incidente de 2026-09-23): uma ocorrencia represada aqui nao
    // corrompe dado, manda template de verdade pelo WhatsApp pra
    // telefone real.
    await registerRepeatableJob(this.reminderQueue, SEND_APPOINTMENT_REMINDER_JOB_ID, REMINDER_CHECK_INTERVAL_MS);
    await registerRepeatableJob(this.reprocessQueue, REPROCESS_STUCK_TURNS_JOB_ID, REPROCESS_CHECK_INTERVAL_MS);
  }
}

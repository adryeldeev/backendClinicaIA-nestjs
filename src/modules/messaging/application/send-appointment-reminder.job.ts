import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { ListAppointmentsNeedingReminderUseCase, MarkReminderSentUseCase } from '../../scheduling';
import type { Env } from '../../../shared/config/env.schema';
import { formatDateTimePtBr } from '../../../shared/kernel/format-datetime-pt-br';
import { APPOINTMENT_REMINDER_QUEUE, OUTBOX_QUEUE, outboxJobId } from '../../../shared/queue/queue.tokens';
import { PrismaOutboxRepository } from '../infrastructure/prisma-outbox.repository';
import { OUTBOX_ATTEMPTS, OUTBOX_BACKOFF_DELAY_MS } from './process-inbound.job';

// Precisa bater com a janela usada em ListAppointmentsNeedingReminderUseCase
// (a janela cobre exatamente um tick, sem lacuna).
export const REMINDER_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Fase 5: lembrete de consulta 24h antes, via template aprovado (RN-18 —
 * lembrete e enviado de fora da janela de mensageria do paciente na
 * pratica, entao tem que ser template, nunca texto livre). Mesmo padrao
 * do ExpireHoldsJob: job repetivel, registrado no OnModuleInit do modulo
 * dono (ver MessagingModule).
 */
@Processor(APPOINTMENT_REMINDER_QUEUE)
export class SendAppointmentReminderJob extends WorkerHost {
  private readonly logger = new Logger(SendAppointmentReminderJob.name);

  constructor(
    private readonly listNeedingReminder: ListAppointmentsNeedingReminderUseCase,
    private readonly markReminderSent: MarkReminderSentUseCase,
    private readonly outbox: PrismaOutboxRepository,
    @InjectQueue(OUTBOX_QUEUE) private readonly outboxQueue: Queue,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const appointments = await this.listNeedingReminder.execute(REMINDER_CHECK_INTERVAL_MS);
    if (appointments.length === 0) {
      return;
    }

    const templateName = this.config.get('WHATSAPP_REMINDER_TEMPLATE_NAME', { infer: true });
    const timezone = this.config.get('CLINIC_TIMEZONE', { infer: true });

    for (const appointment of appointments) {
      const label = formatDateTimePtBr(appointment.startsAt, timezone);
      const outboxMessage = await this.outbox.createTemplate(appointment.patientPhoneE164, templateName, [
        appointment.procedureName,
        appointment.professionalName,
        label,
      ]);

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

      // Marca enviado ja aqui (nao so quando o outbox confirma sucesso) —
      // evita reenviar o mesmo lembrete em cada tick enquanto o outbox
      // ainda esta tentando; se o envio falhar de vez, o paciente so fica
      // sem lembrete desta vez, o que e preferivel a manda-lo repetido.
      await this.markReminderSent.execute(appointment.appointmentId);
    }

    this.logger.log(`${appointments.length} lembrete(s) de consulta enfileirado(s).`);
  }
}

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SCHEDULING_MAINTENANCE_QUEUE } from '../../../shared/queue/queue.tokens';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { PrismaAppointmentRepository } from '../infrastructure/prisma-appointment.repository';

/**
 * RN-08: hold nao confirmado em HOLD_TTL_MINUTES volta a ficar disponivel.
 * Roda como job repetivel do BullMQ (decisao 3 do plano da Fase 2) — todas
 * as instancias do app competem pelo mesmo job no mesmo Redis, entao so
 * uma executa por tick, sem precisar de lock distribuido manual.
 */
@Processor(SCHEDULING_MAINTENANCE_QUEUE)
export class ExpireHoldsJob extends WorkerHost {
  private readonly logger = new Logger(ExpireHoldsJob.name);

  constructor(
    private readonly appointments: PrismaAppointmentRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const expiredCount = await this.appointments.expireOverdueHolds(this.clock.now());
    if (expiredCount > 0) {
      this.logger.log(`${expiredCount} hold(s) expirado(s).`);
    }
  }
}

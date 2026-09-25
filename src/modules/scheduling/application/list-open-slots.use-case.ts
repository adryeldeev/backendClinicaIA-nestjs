import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CandidateSlot, ListAvailableSlotsUseCase } from '../../catalog';
import type { Env } from '../../../shared/config/env.schema';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { evaluateSlotPolicy } from '../domain/services/scheduling-policy';
import { PrismaAppointmentRepository } from '../infrastructure/prisma-appointment.repository';

export interface ListOpenSlotsInput {
  professionalId: string;
  procedureId: string;
  fromUtc: Date;
  toUtc: Date;
}

/**
 * Combina catalog (grade do profissional) com scheduling (o que ja esta
 * ocupado) e aplica RN-04/05 — o resultado e o que pode ser realmente
 * ofertado ao paciente. Isso e o que a tool `listar_horarios` da Fase 3
 * vai chamar.
 */
@Injectable()
export class ListOpenSlotsUseCase {
  constructor(
    private readonly listAvailableSlots: ListAvailableSlotsUseCase,
    private readonly appointments: PrismaAppointmentRepository,
    private readonly config: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(input: ListOpenSlotsInput): Promise<CandidateSlot[]> {
    const [candidates, booked] = await Promise.all([
      this.listAvailableSlots.execute(input),
      this.appointments.listBookedIntervals(input.professionalId, input.fromUtc, input.toUtc),
    ]);

    const now = this.clock.now();
    const minLeadTimeHours = this.config.get('MIN_LEAD_TIME_HOURS', { infer: true });
    const maxLookaheadDays = this.config.get('MAX_LOOKAHEAD_DAYS', { infer: true });

    return candidates.filter(
      (candidate) =>
        evaluateSlotPolicy({
          slot: candidate,
          now,
          minLeadTimeHours,
          maxLookaheadDays,
          candidateSlots: candidates,
          bookedIntervals: booked,
        }).ok,
    );
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetProcedureUseCase, ListAvailableSlotsUseCase } from '../../catalog';
import type { Env } from '../../../shared/config/env.schema';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { InvalidSlotError } from '../domain/errors/invalid-slot.error';
import { evaluateSlotPolicy } from '../domain/services/scheduling-policy';
import { PrismaAppointmentRepository, type AppointmentCreatedBy } from '../infrastructure/prisma-appointment.repository';

const SEARCH_WINDOW_MARGIN_MS = 24 * 60 * 60 * 1000;

export interface HoldSlotInput {
  professionalId: string;
  procedureId: string;
  patientId: string;
  startsAt: Date;
  createdBy: AppointmentCreatedBy;
}

export interface HoldSlotResult {
  appointmentId: string;
  holdExpiresAt: Date;
}

@Injectable()
export class HoldSlotUseCase {
  constructor(
    private readonly listAvailableSlots: ListAvailableSlotsUseCase,
    private readonly getProcedure: GetProcedureUseCase,
    private readonly appointments: PrismaAppointmentRepository,
    private readonly config: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(input: HoldSlotInput): Promise<HoldSlotResult> {
    const procedure = await this.getProcedure.execute(input.procedureId);
    const endsAt = new Date(input.startsAt.getTime() + procedure.durationMin * 60_000);

    // Janela de busca generosa (+-1 dia) so para garantir que o dia local
    // inteiro (na timezone da clinica) do slot pedido esteja coberto,
    // independente do offset UTC da clinica. generateCandidateSlots itera
    // por dia local internamente.
    const searchFrom = new Date(input.startsAt.getTime() - SEARCH_WINDOW_MARGIN_MS);
    const searchTo = new Date(input.startsAt.getTime() + SEARCH_WINDOW_MARGIN_MS);

    const [candidates, booked] = await Promise.all([
      this.listAvailableSlots.execute({
        professionalId: input.professionalId,
        procedureId: input.procedureId,
        fromUtc: searchFrom,
        toUtc: searchTo,
      }),
      this.appointments.listBookedIntervals(input.professionalId, searchFrom, searchTo),
    ]);

    const now = this.clock.now();
    const verdict = evaluateSlotPolicy({
      slot: { startsAt: input.startsAt, endsAt },
      now,
      minLeadTimeHours: this.config.get('MIN_LEAD_TIME_HOURS', { infer: true }),
      maxLookaheadDays: this.config.get('MAX_LOOKAHEAD_DAYS', { infer: true }),
      candidateSlots: candidates,
      bookedIntervals: booked,
    });
    if (!verdict.ok) {
      throw new InvalidSlotError(verdict.reason);
    }

    // RN-07: um paciente tem no maximo 1 hold ativo por vez.
    const existingHold = await this.appointments.findActiveHoldByPatient(input.patientId);
    if (existingHold) {
      await this.appointments.expireById(existingHold.id);
    }

    const holdTtlMinutes = this.config.get('HOLD_TTL_MINUTES', { infer: true });
    const holdExpiresAt = new Date(now.getTime() + holdTtlMinutes * 60_000);

    // Ultima linha de defesa contra double-booking: a constraint de
    // exclusao (appointment_no_overlap, GIST). Se duas requisicoes
    // chegarem aqui concorrentemente para o mesmo slot OU para slots que
    // se sobrepoem (durationMin variavel), so uma passa — a outra recebe
    // SlotTakenError do repositorio.
    const appointment = await this.appointments.holdSlot({
      professionalId: input.professionalId,
      patientId: input.patientId,
      procedureId: input.procedureId,
      startsAt: input.startsAt,
      endsAt,
      holdExpiresAt,
      createdBy: input.createdBy,
    });

    return { appointmentId: appointment.id, holdExpiresAt };
  }
}

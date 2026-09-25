import type { CandidateSlot } from '../../../catalog';

export interface BookedInterval {
  startsAt: Date;
  endsAt: Date;
}

export interface SlotPolicyInput {
  slot: { startsAt: Date; endsAt: Date };
  now: Date;
  minLeadTimeHours: number;
  maxLookaheadDays: number;
  candidateSlots: CandidateSlot[];
  bookedIntervals: BookedInterval[];
}

export type SlotPolicyResult = { ok: true } | { ok: false; reason: string };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }): boolean {
  return a.startsAt < b.endsAt && a.endsAt > b.startsAt;
}

function isCandidate(slot: { startsAt: Date; endsAt: Date }, candidates: CandidateSlot[]): boolean {
  return candidates.some(
    (candidate) =>
      candidate.startsAt.getTime() === slot.startsAt.getTime() &&
      candidate.endsAt.getTime() === slot.endsAt.getTime(),
  );
}

/**
 * Decide se um slot especifico pode ser reservado agora. Funcao pura — quem
 * chama ja buscou candidateSlots (catalog) e bookedIntervals (scheduling)
 * antes. Nao houve I/O aqui, so as regras RN-04/05/06.
 */
export function evaluateSlotPolicy(input: SlotPolicyInput): SlotPolicyResult {
  const { slot, now, minLeadTimeHours, maxLookaheadDays, candidateSlots, bookedIntervals } = input;

  const minStartsAt = new Date(now.getTime() + minLeadTimeHours * HOUR_MS);
  if (slot.startsAt < minStartsAt) {
    return { ok: false, reason: `RN-04: precisa de pelo menos ${minLeadTimeHours}h de antecedencia.` };
  }

  const maxStartsAt = new Date(now.getTime() + maxLookaheadDays * DAY_MS);
  if (slot.startsAt > maxStartsAt) {
    return { ok: false, reason: `RN-05: fora da janela de ${maxLookaheadDays} dias.` };
  }

  if (!isCandidate(slot, candidateSlots)) {
    return {
      ok: false,
      reason: 'RN-06: horario fora da grade do profissional ou bloqueado por excecao.',
    };
  }

  if (bookedIntervals.some((booked) => overlaps(slot, booked))) {
    return { ok: false, reason: 'RN-06: ja existe uma consulta ativa nesse horario.' };
  }

  return { ok: true };
}

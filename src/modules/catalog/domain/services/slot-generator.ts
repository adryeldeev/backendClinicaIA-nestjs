import { DateTime } from 'luxon';

export interface AvailabilityRuleInput {
  weekday: number; // 0 = domingo ... 6 = sabado (mesma convencao de Date#getDay())
  startTime: string; // "HH:mm", horario local da clinica
  endTime: string; // "HH:mm", horario local da clinica
  slotMinutes: number;
}

export interface AvailabilityExceptionInput {
  startsAt: Date; // UTC
  endsAt: Date; // UTC
  blocking: boolean;
}

export interface GenerateCandidateSlotsInput {
  rules: AvailabilityRuleInput[];
  exceptions: AvailabilityExceptionInput[];
  timezone: string;
  fromUtc: Date;
  toUtc: Date;
  /**
   * Duracao do procedimento pedido — o candidato tem esse tamanho, nao o
   * `rule.slotMinutes` (que continua sendo so o passo do grid, i.e. de
   * quanto em quanto tempo um novo horario de INICIO e oferecido). Antes
   * dessa mudanca, um procedimento de 60min num grid de 30min nunca batia
   * com nenhum candidato (sempre gerado com 30min de duracao) — RN-06
   * rejeitava de forma silenciosa qualquer duracao diferente do grid.
   */
  slotDurationMinutes: number;
}

export interface CandidateSlot {
  startsAt: Date; // UTC
  endsAt: Date; // UTC
}

function parseHourMinute(hhmm: string): { hour: number; minute: number } {
  const [hour, minute] = hhmm.split(':').map(Number);
  return { hour, minute };
}

function overlapsBlockingException(
  slot: CandidateSlot,
  exceptions: AvailabilityExceptionInput[],
): boolean {
  return exceptions.some(
    (exception) =>
      exception.blocking &&
      slot.startsAt < exception.endsAt &&
      slot.endsAt > exception.startsAt,
  );
}

/**
 * Gera os slots candidatos a partir das regras de disponibilidade (RN-06,
 * parte "existe AvailabilityRule cobrindo" + "nao ha AvailabilityException
 * bloqueante"). Nao sabe nada sobre Appointment — quem exclui horarios ja
 * ocupados e o SchedulingPolicy, no modulo scheduling.
 *
 * AvailabilityException com blocking=false (disponibilidade extra) nao gera
 * slots adicionais nesta versao — apenas nao bloqueia. Gerar slots a partir
 * de excecoes nao-bloqueantes fica para quando houver um caso de uso real
 * que precise disso.
 */
export function generateCandidateSlots(input: GenerateCandidateSlotsInput): CandidateSlot[] {
  const { rules, exceptions, timezone, fromUtc, toUtc, slotDurationMinutes } = input;
  const slots: CandidateSlot[] = [];

  let dayCursor = DateTime.fromJSDate(fromUtc, { zone: 'utc' }).setZone(timezone).startOf('day');
  const endCursor = DateTime.fromJSDate(toUtc, { zone: 'utc' }).setZone(timezone).endOf('day');

  while (dayCursor <= endCursor) {
    const ourWeekday = dayCursor.weekday % 7; // luxon: 1=segunda..7=domingo -> 0=domingo..6=sabado

    const rulesForDay = rules.filter((rule) => rule.weekday === ourWeekday);

    for (const rule of rulesForDay) {
      const start = parseHourMinute(rule.startTime);
      const end = parseHourMinute(rule.endTime);

      let slotStart = dayCursor.set({
        hour: start.hour,
        minute: start.minute,
        second: 0,
        millisecond: 0,
      });
      const windowEnd = dayCursor.set({
        hour: end.hour,
        minute: end.minute,
        second: 0,
        millisecond: 0,
      });

      // O passo do cursor e o grid da regra (rule.slotMinutes) — de quanto
      // em quanto tempo um novo horario de inicio e oferecido. A duracao
      // do candidato e a do procedimento pedido, que pode ser maior que o
      // passo (ex.: grid de 30min, procedimento de 60min: candidatos as
      // 14:00-15:00, 14:30-15:30, ... se sobrepondo entre si de proposito —
      // quem decide qual pode ser reservado de fato e a constraint de
      // exclusao + o filtro de bookedIntervals, nao o gerador).
      while (slotStart.plus({ minutes: slotDurationMinutes }) <= windowEnd) {
        const slotEnd = slotStart.plus({ minutes: slotDurationMinutes });
        const candidate: CandidateSlot = {
          startsAt: slotStart.toUTC().toJSDate(),
          endsAt: slotEnd.toUTC().toJSDate(),
        };

        if (
          candidate.startsAt >= fromUtc &&
          candidate.startsAt <= toUtc &&
          !overlapsBlockingException(candidate, exceptions)
        ) {
          slots.push(candidate);
        }

        slotStart = slotStart.plus({ minutes: rule.slotMinutes });
      }
    }

    dayCursor = dayCursor.plus({ days: 1 });
  }

  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

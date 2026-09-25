import { DateTime } from 'luxon';

export interface AppointmentTimeWindow {
  id: string;
  startsAt: Date; // UTC
  endsAt: Date; // UTC
}

export interface AvailabilityWindow {
  startTime: string; // "HH:mm", horario local da clinica
  endTime: string; // "HH:mm", horario local da clinica
}

function parseHourMinute(hhmm: string): { hour: number; minute: number } {
  const [hour, minute] = hhmm.split(':').map(Number);
  return { hour, minute };
}

/**
 * Caso 3 do plano da Etapa 3 (Fase 6): reduzir/remover uma AvailabilityRule
 * nunca cancela nem move consulta confirmada — so avisa quando alguma
 * deixou de caber na janela nova. `appointments` ja deve vir filtrado pelo
 * chamador (profissional certo, dia da semana da regra, so futuras,
 * so CONFIRMED) — esta funcao so faz a comparacao de horario no fuso da
 * clinica, mesma logica de conversao ja usada em
 * catalog/domain/services/slot-generator.ts (nao reimplementada, so nao
 * compartilhada em codigo porque cada modulo e dono do seu dominio).
 */
export function findAppointmentsOutsideWindow(
  appointments: AppointmentTimeWindow[],
  window: AvailabilityWindow,
  timezone: string,
): AppointmentTimeWindow[] {
  const start = parseHourMinute(window.startTime);
  const end = parseHourMinute(window.endTime);

  return appointments.filter((appointment) => {
    const localStart = DateTime.fromJSDate(appointment.startsAt, { zone: 'utc' }).setZone(timezone);
    const localEnd = DateTime.fromJSDate(appointment.endsAt, { zone: 'utc' }).setZone(timezone);

    const windowStart = localStart.set({ hour: start.hour, minute: start.minute, second: 0, millisecond: 0 });
    const windowEnd = localStart.set({ hour: end.hour, minute: end.minute, second: 0, millisecond: 0 });

    return localStart < windowStart || localEnd > windowEnd;
  });
}

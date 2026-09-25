import { DateTime } from 'luxon';

/**
 * RN-19: toda data apresentada ao paciente em portugues por extenso e no
 * fuso da clinica, ex.: "quinta-feira, 18 de setembro, as 14h30" — mesmo
 * com o servidor rodando em UTC (AD-11).
 */
export function formatDateTimePtBr(utcDate: Date, timezone: string): string {
  const local = DateTime.fromJSDate(utcDate, { zone: 'utc' }).setZone(timezone).setLocale('pt-BR');

  const weekday = local.toFormat('cccc');
  const day = local.toFormat('d');
  const month = local.toFormat('LLLL');
  const hour = local.toFormat('HH');
  const minute = local.toFormat('mm');

  return `${weekday}, ${day} de ${month}, às ${hour}h${minute}`;
}

import { describe, expect, it } from 'vitest';
import { findAppointmentsOutsideWindow } from '../../src/modules/scheduling/domain/services/find-appointments-outside-window';

const TIMEZONE = 'America/Fortaleza'; // UTC-3, sem horario de verao

describe('findAppointmentsOutsideWindow', () => {
  it('consulta dentro da nova janela nao aparece no aviso', () => {
    // 10h local = 13h UTC
    const appointment = {
      id: 'a1',
      startsAt: new Date('2026-03-10T13:00:00.000Z'),
      endsAt: new Date('2026-03-10T13:30:00.000Z'),
    };

    const result = findAppointmentsOutsideWindow(
      [appointment],
      { startTime: '08:00', endTime: '18:00' },
      TIMEZONE,
    );

    expect(result).toEqual([]);
  });

  /**
   * O cenario exato que o usuario descreveu: clinica muda de 8-18 pra
   * 8-12, consulta confirmada as 15h continua existindo mas fica fora da
   * janela nova.
   */
  it('consulta as 15h local fica fora quando a janela encolhe pra 8-12', () => {
    // 15h local = 18h UTC
    const appointment = {
      id: 'a1',
      startsAt: new Date('2026-03-10T18:00:00.000Z'),
      endsAt: new Date('2026-03-10T18:30:00.000Z'),
    };

    const result = findAppointmentsOutsideWindow(
      [appointment],
      { startTime: '08:00', endTime: '12:00' },
      TIMEZONE,
    );

    expect(result).toEqual([appointment]);
  });

  it('consulta que comeca dentro mas termina depois do novo endTime tambem conta como fora', () => {
    // 11h45 as 12h15 local — comeca antes das 12h, termina depois.
    const appointment = {
      id: 'a1',
      startsAt: new Date('2026-03-10T14:45:00.000Z'),
      endsAt: new Date('2026-03-10T15:15:00.000Z'),
    };

    const result = findAppointmentsOutsideWindow(
      [appointment],
      { startTime: '08:00', endTime: '12:00' },
      TIMEZONE,
    );

    expect(result).toEqual([appointment]);
  });

  it('consulta que comeca antes do novo startTime conta como fora, mesmo terminando dentro', () => {
    // 7h45 as 8h15 local — comeca antes das 8h.
    const appointment = {
      id: 'a1',
      startsAt: new Date('2026-03-10T10:45:00.000Z'),
      endsAt: new Date('2026-03-10T11:15:00.000Z'),
    };

    const result = findAppointmentsOutsideWindow(
      [appointment],
      { startTime: '08:00', endTime: '18:00' },
      TIMEZONE,
    );

    expect(result).toEqual([appointment]);
  });

  it('varias consultas: so devolve as que realmente ficaram fora', () => {
    const dentro = { id: 'dentro', startsAt: new Date('2026-03-10T13:00:00.000Z'), endsAt: new Date('2026-03-10T13:30:00.000Z') }; // 10h local
    const fora = { id: 'fora', startsAt: new Date('2026-03-10T18:00:00.000Z'), endsAt: new Date('2026-03-10T18:30:00.000Z') }; // 15h local

    const result = findAppointmentsOutsideWindow([dentro, fora], { startTime: '08:00', endTime: '12:00' }, TIMEZONE);

    expect(result).toEqual([fora]);
  });
});

import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { formatDateTimePtBr } from '../../src/shared/kernel/format-datetime-pt-br';

describe('formatDateTimePtBr', () => {
  it(
    'criterio de aceite #10: horario exibido bate com America/Fortaleza mesmo com o instante em UTC ' +
      'de um dia diferente (prova conversao de fuso de verdade, nao so formatacao)',
    () => {
      // 2026-09-18T02:00:00Z em America/Fortaleza (UTC-3, sem horario de
      // verao) e 2026-09-17T23:00:00 local — um dia ANTES em UTC. Se a
      // funcao so formatasse o instante UTC sem converter, o resultado
      // mostraria dia 18 e 02h00, nao dia 17 e 23h00.
      const utcInstant = new Date('2026-09-18T02:00:00.000Z');

      const formatted = formatDateTimePtBr(utcInstant, 'America/Fortaleza');

      expect(formatted).toContain('17 de setembro');
      expect(formatted).toContain('23h00');
      expect(formatted).toContain('às');
      expect(formatted).not.toContain('18 de setembro');
      expect(formatted).not.toContain('02h00');
    },
  );

  it('usa nome de mes e dia da semana por extenso em portugues (RN-19)', () => {
    const utcInstant = new Date('2026-01-01T12:00:00.000Z'); // meio-dia UTC, sem risco de virar dia

    const formatted = formatDateTimePtBr(utcInstant, 'America/Fortaleza');

    expect(formatted).toMatch(
      /^(segunda-feira|terça-feira|quarta-feira|quinta-feira|sexta-feira|sábado|domingo), \d{1,2} de \w+, às \d{2}h\d{2}$/u,
    );
  });
});

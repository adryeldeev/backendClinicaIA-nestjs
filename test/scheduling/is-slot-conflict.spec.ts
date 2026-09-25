import { describe, expect, it } from 'vitest';
import { ExclusionViolationError } from '../../src/shared/kernel/errors/exclusion-violation.error';
import { isSlotConflict } from '../../src/modules/scheduling/infrastructure/prisma-appointment.repository';

describe('isSlotConflict', () => {
  it('reconhece a violacao real (EXCLUDE appointment_no_overlap, ja traduzida por mapPrismaError)', () => {
    expect(isSlotConflict(new ExclusionViolationError('appointment_no_overlap'))).toBe(true);
  });

  /**
   * Achado do usuario (2026-09-24, 2a rodada): checar so o TIPO
   * (ExclusionViolationError) aceitaria QUALQUER constraint EXCLUDE
   * futura, de outra tabela, sem relacao nenhuma com slot, como se fosse
   * "horario ocupado" — mesma classe de bug do achado com
   * DuplicateEntryError na 1a rodada, so que no tipo de erro que
   * `mapPrismaError` passou a traduzir depois.
   */
  it('NAO reconhece uma constraint EXCLUDE de outra tabela como slot ocupado', () => {
    expect(isSlotConflict(new ExclusionViolationError('outra_tabela_sem_relacao'))).toBe(false);
  });

  it('NAO reconhece ExclusionViolationError sem constraint extraida (undefined)', () => {
    expect(isSlotConflict(new ExclusionViolationError(undefined))).toBe(false);
  });

  it('nao reconhece um erro generico qualquer', () => {
    expect(isSlotConflict(new Error('erro qualquer'))).toBe(false);
  });
});

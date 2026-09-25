import { describe, expect, it } from 'vitest';
import { DuplicateEntryError } from '../../src/shared/kernel/errors/duplicate-entry.error';
import { isUniqueViolation } from '../../src/modules/messaging/infrastructure/prisma-inbound-event.repository';

describe('isUniqueViolation (PrismaInboundEventRepository)', () => {
  it('reconhece a violacao real (externalId — chave de idempotencia do AD-06)', () => {
    expect(isUniqueViolation(new DuplicateEntryError(['externalId']))).toBe(true);
  });

  /**
   * Achado do usuario (2026-09-24): checar so o TIPO (DuplicateEntryError)
   * faria qualquer violacao de unicidade nesta tabela ser lida como "wamid
   * ja processado" (AD-06), mesmo vinda de uma coluna sem relacao com
   * idempotencia — descartando a mensagem calada em vez de propagar o
   * erro de verdade.
   */
  it('NAO reconhece DuplicateEntryError de outra coluna como idempotencia', () => {
    expect(isUniqueViolation(new DuplicateEntryError(['outraColuna']))).toBe(false);
    expect(isUniqueViolation(new DuplicateEntryError([]))).toBe(false);
  });

  it('nao reconhece um erro generico qualquer', () => {
    expect(isUniqueViolation(new Error('erro qualquer'))).toBe(false);
  });
});

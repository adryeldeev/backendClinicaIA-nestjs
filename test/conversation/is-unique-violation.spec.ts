import { describe, expect, it } from 'vitest';
import { DuplicateEntryError } from '../../src/shared/kernel/errors/duplicate-entry.error';
import { isUniqueViolation } from '../../src/modules/conversation/application/get-or-create-conversation.use-case';

describe('isUniqueViolation (GetOrCreateConversationUseCase)', () => {
  it('reconhece a violacao real (phoneE164 — corrida de criacao do mesmo paciente)', () => {
    expect(isUniqueViolation(new DuplicateEntryError(['phoneE164']))).toBe(true);
  });

  /**
   * Achado do usuario (2026-09-24): checar so o TIPO faria qualquer
   * violacao de unicidade em Patient ser lida como "corrida de criacao do
   * mesmo paciente" e disparar a releitura por telefone — se a colisao
   * for de outra coluna, essa releitura simplesmente nao acha nada e o
   * bug real fica mascarado atras de um comportamento que parece certo.
   */
  it('NAO reconhece DuplicateEntryError de outra coluna como corrida de criacao do paciente', () => {
    expect(isUniqueViolation(new DuplicateEntryError(['outraColuna']))).toBe(false);
    expect(isUniqueViolation(new DuplicateEntryError([]))).toBe(false);
  });

  it('nao reconhece um erro generico qualquer', () => {
    expect(isUniqueViolation(new Error('erro qualquer'))).toBe(false);
  });
});

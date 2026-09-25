import { describe, expect, it } from 'vitest';
import { normalizePhoneToE164Br } from '../../src/shared/kernel/normalize-phone-br';

describe('normalizePhoneToE164Br', () => {
  it('aceita ja formatado em E.164', () => {
    expect(normalizePhoneToE164Br('+5585999999999')).toBe('+5585999999999');
  });

  it('aceita com pontuacao/espaco, sem codigo do pais (celular, 9 digitos)', () => {
    expect(normalizePhoneToE164Br('(85) 99999-9999')).toBe('+5585999999999');
  });

  it('aceita sem pontuacao, sem codigo do pais (fixo, 8 digitos)', () => {
    expect(normalizePhoneToE164Br('8533334444')).toBe('+558533334444');
  });

  it('aceita com codigo do pais mas sem +', () => {
    expect(normalizePhoneToE164Br('5585999999999')).toBe('+5585999999999');
  });

  it('rejeita numero curto demais (nem DDD+numero, nem +55+DDD+numero)', () => {
    expect(normalizePhoneToE164Br('12345')).toBeNull();
  });

  it('rejeita numero longo demais', () => {
    expect(normalizePhoneToE164Br('123456789012345')).toBeNull();
  });

  it('rejeita string vazia', () => {
    expect(normalizePhoneToE164Br('')).toBeNull();
  });
});

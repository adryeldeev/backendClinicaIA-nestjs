import { describe, expect, it } from 'vitest';
import { redactForLog } from '../../src/shared/kernel/redact-pii';

describe('redactForLog', () => {
  it('mascara numero de telefone', () => {
    const result = redactForLog('Contato: +5585999998888');
    expect(result).not.toContain('5585999998888');
    expect(result).toContain('[telefone redigido]');
  });

  it('trunca texto longo em vez de logar conteudo clinico inteiro', () => {
    const longClinicalText = 'Sinal de urgencia detectado na mensagem do paciente: '.padEnd(200, 'x');
    const result = redactForLog(longClinicalText);
    expect(result.length).toBeLessThan(longClinicalText.length);
    expect(result).toContain('restante redigido');
  });

  it('texto curto sem telefone passa essencialmente intacto (nao ha PII a redigir)', () => {
    expect(redactForLog('RN-02')).toBe('RN-02');
  });
});

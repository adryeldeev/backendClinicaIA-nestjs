import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { checkInputGuardrail } from '../../src/modules/agent/domain/guardrails/input-guardrail';

describe('checkInputGuardrail', () => {
  it('RN-02: sinal de urgencia dispara escalada antes de qualquer chamada ao LLM', () => {
    const verdict = checkInputGuardrail(['estou com uma dor muito forte no peito']);
    expect(verdict.triggered).toBe(true);
    if (verdict.triggered) {
      expect(verdict.reason).toBe('RN-02');
    }
  });

  it('RN-01 / criterio de aceite #6: pedido de orientacao clinica dispara escalada, nunca resposta', () => {
    const verdict = checkInputGuardrail(['qual remedio eu posso tomar pra dor de cabeca?']);
    expect(verdict.triggered).toBe(true);
    if (verdict.triggered) {
      expect(verdict.reason).toBe('RN-01');
    }
  });

  it('pergunta comum sobre agendamento nao aciona guardrail nenhum', () => {
    const verdict = checkInputGuardrail(['queria marcar uma consulta com o Dr. Filipe']);
    expect(verdict).toEqual({ triggered: false });
  });

  it('quando urgencia e orientacao clinica aparecem juntas, RN-02 tem prioridade (mais grave)', () => {
    const verdict = checkInputGuardrail(['estou com dor muito forte, qual remedio eu tomo?']);
    expect(verdict.triggered).toBe(true);
    if (verdict.triggered) {
      expect(verdict.reason).toBe('RN-02');
    }
  });

  it('guardrail olha o conjunto de mensagens do turno, nao so uma isolada', () => {
    const verdict = checkInputGuardrail(['oi', 'to com falta de ar']);
    expect(verdict.triggered).toBe(true);
    if (verdict.triggered) {
      expect(verdict.reason).toBe('RN-02');
    }
  });
});

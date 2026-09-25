import { describe, expect, it } from 'vitest';
import {
  checkOutputGuardrail,
  collectAuthorizedFacts,
  createAuthorizedFacts,
} from '../../src/modules/agent/domain/guardrails/output-guardrail';

describe('collectAuthorizedFacts', () => {
  it('extrai nome e preco de um resultado de tool tipico (convencao existente em toda tool)', () => {
    const facts = createAuthorizedFacts();
    collectAuthorizedFacts(
      [{ id: '1', nome: 'Consulta Cardiologica', duracaoMin: 40, precoReais: 250 }],
      facts,
    );

    expect(facts.names.has('Consulta Cardiologica')).toBe(true);
    expect(facts.amounts.has('250.00')).toBe(true);
  });

  it('percorre estruturas aninhadas (array dentro de objeto, objeto dentro de array)', () => {
    const facts = createAuthorizedFacts();
    collectAuthorizedFacts(
      { resultados: [{ nome: 'Dra. Ana Souza' }, { convenios: [{ nome: 'Unimed', aceito: true }] }] },
      facts,
    );

    expect(facts.names.has('Dra. Ana Souza')).toBe(true);
    expect(facts.names.has('Unimed')).toBe(true);
  });
});

describe('checkOutputGuardrail (RN-03)', () => {
  it('nao acusa valor/nome que vieram de tool neste turno', () => {
    const facts = createAuthorizedFacts();
    collectAuthorizedFacts([{ nome: 'Consulta Cardiologica', precoReais: 250 }], facts);

    const verdict = checkOutputGuardrail('A Consulta Cardiologica custa R$250.', facts);
    expect(verdict.violated).toBe(false);
  });

  it('acusa valor em reais que nao veio de nenhuma tool', () => {
    const facts = createAuthorizedFacts();
    const verdict = checkOutputGuardrail('Essa consulta custa R$300.', facts);

    expect(verdict.violated).toBe(true);
    if (verdict.violated) {
      expect(verdict.unauthorizedMentions.some((m) => m.includes('300'))).toBe(true);
    }
  });

  it('acusa nome de profissional que nao veio de nenhuma tool', () => {
    const facts = createAuthorizedFacts();
    const verdict = checkOutputGuardrail('Voce pode ser atendido pelo Dr. Roberto Lima.', facts);

    expect(verdict.violated).toBe(true);
    if (verdict.violated) {
      expect(verdict.unauthorizedMentions.some((m) => m.includes('Roberto Lima'))).toBe(true);
    }
  });

  it('texto sem valor nem nome proprio passa limpo', () => {
    const facts = createAuthorizedFacts();
    const verdict = checkOutputGuardrail('Claro, posso te ajudar com isso. Qual procedimento voce procura?', facts);
    expect(verdict.violated).toBe(false);
  });
});

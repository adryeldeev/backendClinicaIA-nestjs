export interface AuthorizedFacts {
  names: Set<string>;
  amounts: Set<string>; // normalizado com 2 casas decimais, ex. "250.00"
}

export function createAuthorizedFacts(): AuthorizedFacts {
  return { names: new Set(), amounts: new Set() };
}

function normalizeAmount(value: number): string {
  return value.toFixed(2);
}

/**
 * Extracao GENERICA a partir da convencao ja usada em toda tool existente
 * (campos `nome`/`precoReais` — ver listar-procedimentos.tool.ts,
 * listar-profissionais.tool.ts, consultar-convenios.tool.ts): percorre o
 * `data` de um resultado de tool bem-sucedido recursivamente, sem
 * conhecimento hardcoded de qual tool gerou o dado. Uma tool nova que siga
 * a mesma convencao de nomes de campo entra automaticamente, sem precisar
 * editar este arquivo.
 */
export function collectAuthorizedFacts(data: unknown, into: AuthorizedFacts): void {
  if (Array.isArray(data)) {
    for (const item of data) {
      collectAuthorizedFacts(item, into);
    }
    return;
  }

  if (data !== null && typeof data === 'object') {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (/nome/i.test(key) && typeof value === 'string' && value.trim().length > 0) {
        into.names.add(value.trim());
      }
      if (/preco/i.test(key) && typeof value === 'number') {
        into.amounts.add(normalizeAmount(value));
      }
      collectAuthorizedFacts(value, into);
    }
  }
}

export type OutputGuardrailVerdict =
  | { violated: false }
  | { violated: true; unauthorizedMentions: string[] };

// Valor em reais: "R$ 250", "R$250,00", "250 reais".
const AMOUNT_PATTERN = /R\$\s?(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*reais/gi;

// Sequencia de 2+ palavras capitalizadas (nome proprio composto — "Dra Ana
// Souza", "Bradesco Saude"), ou "Dr./Dra. X" com uma unica palavra depois.
// Limitacao assumida (documentada no plano da Fase 5): regex nao e
// semantico. Falso positivo em nome proprio generico da propria conversa
// (ex.: o paciente se apresentando) e falso negativo em valor escrito por
// extenso incomum sao esperados — mesmo espirito do guardrail de entrada
// (checkInputGuardrail): barato, deterministico, nao e juiz de LLM.
const NAME_PATTERN =
  /\b(?:Dr\.?|Dra\.?)\s+[A-ZÀ-Ú][a-zà-úçã]+(?:\s+[A-ZÀ-Ú][a-zà-úçã]+)*|\b[A-ZÀ-Ú][a-zà-úçã]+(?:\s+[A-ZÀ-Ú][a-zà-úçã]+){1,3}\b/g;

function parseAmount(raw: string): string {
  return normalizeAmount(Number(raw.replace(',', '.')));
}

/**
 * Guardrail de SAIDA (RN-03, secao 13 da SPEC.md): roda depois do LLM,
 * antes do outbox. Rejeita valor em reais ou nome (profissional/procedimento/
 * convenio) que nao apareceu em resultado de tool bem-sucedido NAQUELE
 * TURNO — nao em texto isolado, em `authorized` acumulado pelo loop do
 * orquestrador (ver RunOrchestratorTurnUseCase).
 */
export function checkOutputGuardrail(text: string, authorized: AuthorizedFacts): OutputGuardrailVerdict {
  const unauthorizedMentions: string[] = [];

  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const raw = match[1] ?? match[2];
    if (!raw) continue;
    const normalized = parseAmount(raw);
    if (!authorized.amounts.has(normalized)) {
      unauthorizedMentions.push(match[0]);
    }
  }

  for (const match of text.matchAll(NAME_PATTERN)) {
    const candidate = match[0];
    const isAuthorized = [...authorized.names].some(
      (name) => name.includes(candidate) || candidate.includes(name),
    );
    if (!isAuthorized) {
      unauthorizedMentions.push(candidate);
    }
  }

  if (unauthorizedMentions.length === 0) {
    return { violated: false };
  }
  return { violated: true, unauthorizedMentions };
}

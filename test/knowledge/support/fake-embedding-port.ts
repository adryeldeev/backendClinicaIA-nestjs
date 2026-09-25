import type { EmbeddingPort } from '../../../src/modules/knowledge';

/**
 * Hash simples e estavel (nao criptografico) so pra gerar numeros
 * deterministicos a partir de texto — mesma entrada, mesma saida sempre.
 */
function hashString(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Vetor pseudo-aleatorio mas 100% deterministico (seed = hash do texto).
 * Serve de fallback pra texto que o teste nao escriturou explicitamente —
 * garante que FakeEmbeddingPort nunca lanca nem bate rede, mas a
 * similaridade resultante e arbitraria (nao serve pra testar RANKING,
 * so pra "o pipeline nao quebra com texto desconhecido").
 */
function deterministicFallback(text: string, dimensions: number): number[] {
  let seed = hashString(text) >>> 0;
  const vector: number[] = [];
  for (let i = 0; i < dimensions; i++) {
    // LCG simples (Numerical Recipes) — determinístico, rapido, sem libs.
    seed = (seed * 1664525 + 1013904223) >>> 0;
    vector.push(seed / 0xffffffff - 0.5);
  }
  return vector;
}

/**
 * FakeEmbeddingPort: nunca bate rede. Pra textos registrados explicitamente
 * em `vectors`, devolve exatamente o vetor escolhido pelo teste — e assim
 * que RRF/limiar/ranking viram testaveis de verdade (o teste controla a
 * similaridade exata entre pergunta e chunk, nao so "e deterministico").
 * Texto nao registrado cai no fallback (deterministico, mas arbitrario).
 */
export class FakeEmbeddingPort implements EmbeddingPort {
  private readonly vectors: Map<string, number[]>;

  constructor(
    vectors: Record<string, number[]> = {},
    private readonly dimensions = 768,
  ) {
    this.vectors = new Map(Object.entries(vectors));
  }

  /** Registra/sobrescreve o vetor de um texto especifico depois de construido — util pra cenarios adicionais no mesmo teste. */
  register(text: string, vector: number[]): void {
    this.vectors.set(text, vector);
  }

  async embed(text: string): Promise<number[]> {
    return this.vectors.get(text) ?? deterministicFallback(text, this.dimensions);
  }
}

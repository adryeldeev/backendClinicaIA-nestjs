export interface FusedResult {
  id: string;
  rrfScore: number;
}

/**
 * Reciprocal Rank Fusion (secao 11 da SPEC.md, k=60): combina duas listas
 * ranqueadas (vetorial + textual) numa unica ordem, sem precisar
 * normalizar escalas diferentes entre os dois metodos de busca — RRF
 * soma 1/(k+posicao) por lista em que o item aparece, ignorando o score
 * bruto de cada lista.
 *
 * IMPORTANTE: rrfScore NAO e comparavel a RAG_SCORE_THRESHOLD. Com k=60,
 * o score maximo possivel (1o lugar nas duas listas) e 2/61 =~ 0.033 —
 * numa escala completamente diferente de um limiar tipo 0.35 pensado pra
 * similaridade de cosseno (0 a 1). RRF decide so a ORDEM; a decisao de
 * "vazio se abaixo do limiar" usa a similaridade vetorial real do
 * resultado mais bem ranqueado (ver SearchKnowledgeUseCase), nunca este
 * numero. Ambiguidade da spec original, resolvida e documentada aqui —
 * ver nota na secao 11 da SPEC.md.
 */
export function reciprocalRankFusion(rankedLists: string[][], k = 60): FusedResult[] {
  const scores = new Map<string, number>();

  for (const list of rankedLists) {
    list.forEach((id, index) => {
      const rank = index + 1; // 1-indexado
      const contribution = 1 / (k + rank);
      scores.set(id, (scores.get(id) ?? 0) + contribution);
    });
  }

  return [...scores.entries()]
    .map(([id, rrfScore]) => ({ id, rrfScore }))
    .sort((a, b) => b.rrfScore - a.rrfScore);
}

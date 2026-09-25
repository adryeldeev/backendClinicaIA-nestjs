import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion } from '../../src/modules/knowledge/domain/services/rrf-fusion';

describe('reciprocalRankFusion', () => {
  it('item no topo das duas listas ranqueia acima de item que so aparece numa', () => {
    const vectorRanked = ['A', 'B', 'C'];
    const textRanked = ['A', 'D', 'B'];

    const fused = reciprocalRankFusion([vectorRanked, textRanked]);

    expect(fused[0].id).toBe('A');
    // B aparece nas duas (2o e 3o lugar) — deve ranquear acima de C e D,
    // que aparecem numa unica lista.
    expect(fused.map((r) => r.id).indexOf('B')).toBeLessThan(fused.map((r) => r.id).indexOf('C'));
    expect(fused.map((r) => r.id).indexOf('B')).toBeLessThan(fused.map((r) => r.id).indexOf('D'));
  });

  it('1o lugar nas duas listas soma 1/61 + 1/61 = 2/61 (k=60)', () => {
    const fused = reciprocalRankFusion([['X'], ['X']]);
    expect(fused).toHaveLength(1);
    expect(fused[0].rrfScore).toBeCloseTo(2 / 61, 10);
  });

  it('item ausente de uma lista nao ganha contribuicao dela', () => {
    const fused = reciprocalRankFusion([['X', 'Y'], ['Y']]);
    const scoreY = fused.find((r) => r.id === 'Y')!.rrfScore;
    const scoreX = fused.find((r) => r.id === 'X')!.rrfScore;
    // X: 1o na lista 1 (1/61) + ausente da lista 2 = 1/61
    // Y: 2o na lista 1 (1/62) + 1o na lista 2 (1/61) = 1/62 + 1/61
    expect(scoreX).toBeCloseTo(1 / 61, 10);
    expect(scoreY).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(scoreY).toBeGreaterThan(scoreX);
  });

  it('lista vazia nao quebra e resultado geral vem ordenado por rrfScore decrescente', () => {
    const fused = reciprocalRankFusion([[], ['A', 'B', 'C']]);
    expect(fused.map((r) => r.id)).toEqual(['A', 'B', 'C']);
    for (let i = 1; i < fused.length; i++) {
      expect(fused[i - 1].rrfScore).toBeGreaterThanOrEqual(fused[i].rrfScore);
    }
  });
});

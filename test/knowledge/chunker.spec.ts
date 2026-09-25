import { describe, expect, it } from 'vitest';
import { chunkDocument } from '../../src/modules/knowledge/domain/services/chunker';

// Cada frase tem ~40 chars =~ 10 tokens (aproximacao de 4 chars/token).
function sentence(n: number): string {
  return `Esta e a frase numero ${n} do documento de teste gerado.`;
}

describe('chunkDocument', () => {
  it('documento curto vira um unico chunk', () => {
    const content = `${sentence(1)} ${sentence(2)} ${sentence(3)}`;
    const chunks = chunkDocument(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].ordinal).toBe(0);
    expect(chunks[0].content).toContain(sentence(1));
    expect(chunks[0].content).toContain(sentence(3));
  });

  it('documento vazio nao gera chunk', () => {
    expect(chunkDocument('')).toEqual([]);
    expect(chunkDocument('   ')).toEqual([]);
  });

  it('documento longo vira varios chunks dentro do limite maximo, com overlap entre consecutivos', () => {
    // ~80 frases de ~10 tokens = ~800 tokens, bem acima do limite de 600 —
    // forca pelo menos 2 chunks.
    const sentences = Array.from({ length: 80 }, (_, i) => sentence(i + 1));
    const content = sentences.join(' ');

    const chunks = chunkDocument(content);

    expect(chunks.length).toBeGreaterThanOrEqual(2);

    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(600);
    }

    // Ordinal sequencial, comecando em 0.
    chunks.forEach((chunk, index) => expect(chunk.ordinal).toBe(index));

    // Overlap: alguma frase do fim do chunk N aparece no comeco do chunk N+1.
    for (let i = 0; i < chunks.length - 1; i++) {
      const currentSentences = chunks[i].content.split(/(?<=[.!?])\s+/);
      const lastSentenceOfCurrent = currentSentences[currentSentences.length - 1];
      expect(chunks[i + 1].content).toContain(lastSentenceOfCurrent);
    }

    // Nenhuma frase do documento original se perde — todas aparecem em
    // pelo menos um chunk.
    for (const original of sentences) {
      expect(chunks.some((chunk) => chunk.content.includes(original))).toBe(true);
    }
  });

  it('uma frase sozinha maior que o limite maximo ainda vira um chunk proprio (nunca corta frase ao meio)', () => {
    // ~400 palavras sem pontuacao interna =~ 800+ tokens, uma unica frase
    // (so termina com "." no final) — acima do limite de 600.
    const hugeSentence = `${'palavra '.repeat(400).trim()}.`;
    const chunks = chunkDocument(hugeSentence);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(hugeSentence);
    expect(chunks[0].tokenCount).toBeGreaterThan(600);
  });
});

export interface DocumentChunk {
  ordinal: number;
  content: string;
  tokenCount: number;
}

// Secao 11 da SPEC.md: "chunking semantico (400-600 tokens, overlap 15%)".
const MAX_CHUNK_TOKENS = 600;
const OVERLAP_RATIO = 0.15;

// Aproximacao de tokens sem dependencia de tokenizer real (nenhuma
// biblioteca de tokenizacao esta em uso no projeto — CLAUDE.md pede
// justificar dependencia nova, e 4 caracteres/token e uma aproximacao
// padrao suficiente pra decidir limite de chunk, nao pra contagem exata
// de billing). Se um dia isso importar pra custo real de API, trocar por
// um tokenizer de verdade e decisao a parte.
const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

/** Divide por fim de frase (. ! ?), preservando a pontuacao. */
function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** Sufixo de frases cujo total de tokens cobre ~OVERLAP_RATIO do chunk anterior. */
function takeOverlapTail(sentences: string[]): string[] {
  const totalTokens = estimateTokens(sentences.join(' '));
  const targetOverlapTokens = totalTokens * OVERLAP_RATIO;

  const tail: string[] = [];
  let tailTokens = 0;
  for (let i = sentences.length - 1; i >= 0 && tailTokens < targetOverlapTokens; i--) {
    tail.unshift(sentences[i]);
    tailTokens += estimateTokens(sentences[i]);
  }
  return tail;
}

function finalizeChunk(sentences: string[], ordinal: number): DocumentChunk {
  const content = sentences.join(' ');
  return { ordinal, content, tokenCount: estimateTokens(content) };
}

/**
 * Chunking semantico: acumula frases ate perto do limite maximo, depois
 * comeca o proximo chunk carregando as ultimas frases do anterior
 * (overlap ~15%) pra nao perder contexto na fronteira entre chunks. Uma
 * frase sozinha maior que MAX_CHUNK_TOKENS ainda assim vira um chunk
 * proprio (nunca corta uma frase ao meio).
 */
export function chunkDocument(content: string): DocumentChunk[] {
  const sentences = splitIntoSentences(content);
  if (sentences.length === 0) {
    return [];
  }

  const chunks: DocumentChunk[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokens(sentence);

    if (currentTokens + sentenceTokens > MAX_CHUNK_TOKENS && current.length > 0) {
      chunks.push(finalizeChunk(current, chunks.length));
      current = takeOverlapTail(current);
      currentTokens = estimateTokens(current.join(' '));
    }

    current.push(sentence);
    currentTokens += sentenceTokens;
  }

  if (current.length > 0) {
    chunks.push(finalizeChunk(current, chunks.length));
  }

  return chunks;
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../shared/config/env.schema';
import { fetchWithRetry } from '../../../shared/http/fetch-with-retry';
import type { EmbeddingPort } from '../ports/embedding.port';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface EmbedContentResponse {
  embedding?: { values?: number[] };
  error?: { message?: string };
}

/**
 * Implementa EmbeddingPort via fetch nativo, mesmo padrao do
 * GeminiLlmAdapter (sem SDK novo) — reaproveita fetchWithRetry (429/5xx,
 * 3 tentativas com backoff+jitter), a mesma licao da Fase 3.
 *
 * outputDimensionality confirmado na mao contra a API real: com
 * gemini-embedding-001, devolve exatamente essa quantidade de floats (ver
 * comentario em env.schema.ts) — nao e um pedido "melhor esforco".
 */
@Injectable()
export class GeminiEmbeddingAdapter implements EmbeddingPort {
  private readonly logger = new Logger(GeminiEmbeddingAdapter.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async embed(text: string): Promise<number[]> {
    const apiKey = this.config.get('GEMINI_API_KEY', { infer: true });
    const model = this.config.get('EMBEDDING_MODEL', { infer: true });
    const dimensions = this.config.get('EMBEDDING_DIMENSIONS', { infer: true });

    const response = await fetchWithRetry(`${GEMINI_API_BASE}/${model}:embedContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        outputDimensionality: dimensions,
      }),
    });

    const payload = (await response.json()) as EmbedContentResponse;

    if (!response.ok) {
      const reason = payload.error?.message ?? `HTTP ${response.status}`;
      this.logger.error(`Falha ao chamar embedContent do Gemini: ${reason}`);
      throw new Error(`gemini_embedding_failed: ${reason}`);
    }

    const values = payload.embedding?.values;
    if (!values || values.length !== dimensions) {
      throw new Error(
        `gemini_embedding_failed: esperava vetor de ${dimensions} dimensoes, recebeu ${values?.length ?? 0}`,
      );
    }

    return values;
  }
}

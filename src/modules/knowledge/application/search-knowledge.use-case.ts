import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../shared/config/env.schema';
import { RetrieveKnowledgeCandidatesUseCase } from './retrieve-knowledge-candidates.use-case';

export interface KnowledgeSearchResult {
  conteudo: string;
  fonte: string;
  score: number;
}

/**
 * Secao 11 da SPEC.md: RetrieveKnowledgeCandidatesUseCase ja devolve o top 5
 * com a similaridade de cosseno real de cada um; aqui so decide o corte —
 * se melhor score < RAG_SCORE_THRESHOLD → retorna vazio. Vazio significa
 * vazio: nunca devolve o "melhor que tem" abaixo do limiar.
 */
@Injectable()
export class SearchKnowledgeUseCase {
  constructor(
    private readonly retrieve: RetrieveKnowledgeCandidatesUseCase,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async execute(pergunta: string): Promise<KnowledgeSearchResult[]> {
    const candidates = await this.retrieve.execute(pergunta);
    if (candidates.length === 0) {
      return [];
    }

    const threshold = this.config.get('RAG_SCORE_THRESHOLD', { infer: true });
    if (candidates[0].score < threshold) {
      return [];
    }

    return candidates;
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../shared/config/env.schema';
import { RetrieveKnowledgeCandidatesUseCase, type KnowledgeCandidate } from './retrieve-knowledge-candidates.use-case';

export interface TestSearchCandidate extends KnowledgeCandidate {
  passesThreshold: boolean;
}

export interface TestSearchResult {
  threshold: number;
  resultados: TestSearchCandidate[];
}

/**
 * POST /api/admin/knowledge/test-search — nao usado pelo agente. Ferramenta
 * de calibracao (achado do usuario, nao estava na SPEC original): o mesmo
 * pipeline de SearchKnowledgeUseCase, mas SEM cortar pelo RAG_SCORE_THRESHOLD
 * — devolve os 5 candidatos com o score real de cada um e se passariam no
 * limiar atual, pro dono da clinica ver o que foi de fato recuperado e
 * ajustar o texto dos documentos quando a base real crescer e a
 * distribuicao de score mudar (limiar calibrado com 4 documentos de
 * exemplo, ver secao 11 da SPEC.md).
 */
@Injectable()
export class TestSearchUseCase {
  constructor(
    private readonly retrieve: RetrieveKnowledgeCandidatesUseCase,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async execute(pergunta: string): Promise<TestSearchResult> {
    const candidates = await this.retrieve.execute(pergunta);
    const threshold = this.config.get('RAG_SCORE_THRESHOLD', { infer: true });

    return {
      threshold,
      resultados: candidates.map((candidate) => ({
        ...candidate,
        passesThreshold: candidate.score >= threshold,
      })),
    };
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { reciprocalRankFusion } from '../domain/services/rrf-fusion';
import { PrismaKnowledgeRepository } from '../infrastructure/prisma-knowledge.repository';
import { EMBEDDING_PORT, type EmbeddingPort } from '../ports/embedding.port';

const CANDIDATES_PER_METHOD = 20;
const TOP_K = 5;

export interface KnowledgeCandidate {
  conteudo: string;
  fonte: string;
  score: number;
}

/**
 * Nucleo de busca (secao 11 da SPEC.md: embed -> hibrido -> RRF -> top 5 ->
 * similaridade real por candidato) reaproveitado por SearchKnowledgeUseCase
 * (agente, corta pelo RAG_SCORE_THRESHOLD) e TestSearchUseCase (painel
 * admin, Etapa 5 — expoe o score de cada candidato SEM cortar, pra calibrar
 * o limiar/o texto dos documentos contra a base real).
 */
@Injectable()
export class RetrieveKnowledgeCandidatesUseCase {
  constructor(
    @Inject(EMBEDDING_PORT) private readonly embeddings: EmbeddingPort,
    private readonly knowledge: PrismaKnowledgeRepository,
  ) {}

  async execute(pergunta: string): Promise<KnowledgeCandidate[]> {
    const queryEmbedding = await this.embeddings.embed(pergunta);

    const [vectorResults, textResults] = await Promise.all([
      this.knowledge.searchByVector(queryEmbedding, CANDIDATES_PER_METHOD),
      this.knowledge.searchByText(pergunta, CANDIDATES_PER_METHOD),
    ]);

    const fused = reciprocalRankFusion([
      vectorResults.map((r) => r.chunkId),
      textResults.map((r) => r.chunkId),
    ]);

    if (fused.length === 0) {
      return [];
    }

    const top = fused.slice(0, TOP_K);
    const similarities = await this.knowledge.getSimilarities(
      queryEmbedding,
      top.map((r) => r.id),
    );

    const chunks = await this.knowledge.getChunksWithDocument(top.map((r) => r.id));
    const chunksById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));

    return top
      .map((fusedResult) => {
        const chunk = chunksById.get(fusedResult.id);
        if (!chunk) {
          return null;
        }
        return {
          conteudo: chunk.content,
          fonte: chunk.documentTitle,
          score: similarities.get(fusedResult.id) ?? 0,
        };
      })
      .filter((result): result is KnowledgeCandidate => result !== null);
  }
}

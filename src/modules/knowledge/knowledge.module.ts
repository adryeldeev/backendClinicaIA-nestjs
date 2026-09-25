import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../shared/config/env.schema';
import { QueueModule } from '../../shared/queue/bullmq.module';
import { IdentityModule } from '../identity';
import { ChunkAndEmbedDocumentUseCase } from './application/chunk-and-embed-document.use-case';
import { CreateDocumentUseCase } from './application/create-document.use-case';
import { GetDocumentUseCase } from './application/get-document.use-case';
import { IngestDocumentUseCase } from './application/ingest-document.use-case';
import { ListDocumentsUseCase } from './application/list-documents.use-case';
import { ReindexDocumentUseCase } from './application/reindex-document.use-case';
import { ReindexKnowledgeDocumentJob } from './application/reindex-knowledge-document.job';
import { RetrieveKnowledgeCandidatesUseCase } from './application/retrieve-knowledge-candidates.use-case';
import { SearchKnowledgeUseCase } from './application/search-knowledge.use-case';
import { TestSearchUseCase } from './application/test-search.use-case';
import { GeminiEmbeddingAdapter } from './infrastructure/gemini-embedding.adapter';
import { PrismaKnowledgeRepository } from './infrastructure/prisma-knowledge.repository';
import { KnowledgeAdminController } from './interface/knowledge.admin-controller';
import { EMBEDDING_PORT } from './ports/embedding.port';

@Module({
  imports: [QueueModule, IdentityModule],
  controllers: [KnowledgeAdminController],
  providers: [
    PrismaKnowledgeRepository,
    { provide: EMBEDDING_PORT, useClass: GeminiEmbeddingAdapter },
    ChunkAndEmbedDocumentUseCase,
    RetrieveKnowledgeCandidatesUseCase,
    SearchKnowledgeUseCase,
    IngestDocumentUseCase,
    ListDocumentsUseCase,
    GetDocumentUseCase,
    CreateDocumentUseCase,
    ReindexDocumentUseCase,
    TestSearchUseCase,
    ReindexKnowledgeDocumentJob,
  ],
  exports: [SearchKnowledgeUseCase, IngestDocumentUseCase],
})
export class KnowledgeModule implements OnModuleInit {
  constructor(
    private readonly knowledge: PrismaKnowledgeRepository,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * EMBEDDING_DIMENSIONS (.env) e a coluna "embedding vector(N)" guardam o
   * mesmo numero em dois lugares sem nada checando que batem — trocar de
   * modelo de embedding sem migration+reingestao trunca ou rejeita vetor
   * silenciosamente. Falha alta e clara no boot, nao um bug de "resultado
   * de busca esquisito" descoberto semanas depois.
   */
  async onModuleInit(): Promise<void> {
    const configured = this.config.get('EMBEDDING_DIMENSIONS', { infer: true });
    const actual = await this.knowledge.getEmbeddingColumnDimensions();

    if (configured !== actual) {
      throw new Error(
        `EMBEDDING_DIMENSIONS (${configured}) nao bate com a dimensao real da coluna KnowledgeChunk.embedding ` +
          `(${actual}). Trocar o modelo de embedding exige migration + reingestao completa da base, nao so mudar o .env.`,
      );
    }
  }
}

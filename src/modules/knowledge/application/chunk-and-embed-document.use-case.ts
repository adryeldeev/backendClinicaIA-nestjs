import { Inject, Injectable } from '@nestjs/common';
import { chunkDocument } from '../domain/services/chunker';
import { EmptyDocumentError } from '../domain/errors/empty-document.error';
import { PrismaKnowledgeRepository } from '../infrastructure/prisma-knowledge.repository';
import { EMBEDDING_PORT, type EmbeddingPort } from '../ports/embedding.port';

/**
 * Nucleo reaproveitado por IngestDocumentUseCase (CLI, sincrono) e por
 * ReindexKnowledgeDocumentJob (painel admin, assincrono): chunking ->
 * embedding (1 chamada de rede por chunk) -> INSERT. Nao ativa a versao —
 * quem chama decide quando (ver PrismaKnowledgeRepository.activateVersion).
 */
@Injectable()
export class ChunkAndEmbedDocumentUseCase {
  constructor(
    @Inject(EMBEDDING_PORT) private readonly embeddings: EmbeddingPort,
    private readonly knowledge: PrismaKnowledgeRepository,
  ) {}

  async execute(documentId: string, content: string): Promise<{ chunkCount: number }> {
    const chunks = chunkDocument(content);
    if (chunks.length === 0) {
      throw new EmptyDocumentError();
    }

    for (const chunk of chunks) {
      const embedding = await this.embeddings.embed(chunk.content);
      await this.knowledge.insertChunk({
        documentId,
        ordinal: chunk.ordinal,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        embedding,
      });
    }

    return { chunkCount: chunks.length };
  }
}

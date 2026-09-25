import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { KnowledgeDocumentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';

export interface RankedChunkId {
  chunkId: string;
}

export interface ChunkWithDocument {
  chunkId: string;
  content: string;
  documentTitle: string;
  sourceRef: string | null;
}

export interface KnowledgeDocumentSummary {
  id: string;
  title: string;
  category: string;
  sourceRef: string | null;
  version: number;
  active: boolean;
  status: KnowledgeDocumentStatus;
  errorMessage: string | null;
  chunkCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeDocumentDetail extends KnowledgeDocumentSummary {
  content: string;
}

/** Prisma nao expressa `vector`/`tsvector` no query builder (coluna `Unsupported` no schema) — SQL cru aqui, tipado. */
@Injectable()
export class PrismaKnowledgeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Top-N por distancia de cosseno (`<=>`) — so entre documentos ativos (RN: reingestao nunca apaga, so desativa a versao antiga). */
  async searchByVector(queryEmbedding: number[], limit: number): Promise<RankedChunkId[]> {
    const vectorLiteral = toVectorLiteral(queryEmbedding);
    return this.prisma.$queryRaw<RankedChunkId[]>`
      SELECT kc.id AS "chunkId"
      FROM "KnowledgeChunk" kc
      JOIN "KnowledgeDocument" kd ON kd.id = kc."documentId"
      WHERE kc.embedding IS NOT NULL AND kd.active = true
      ORDER BY kc.embedding <=> ${vectorLiteral}::vector
      LIMIT ${limit}
    `;
  }

  /** Top-N por `ts_rank` em portugues — so entre documentos ativos. */
  async searchByText(query: string, limit: number): Promise<RankedChunkId[]> {
    return this.prisma.$queryRaw<RankedChunkId[]>`
      SELECT kc.id AS "chunkId"
      FROM "KnowledgeChunk" kc
      JOIN "KnowledgeDocument" kd ON kd.id = kc."documentId"
      WHERE kd.active = true AND kc.content_tsv @@ plainto_tsquery('portuguese', ${query})
      ORDER BY ts_rank(kc.content_tsv, plainto_tsquery('portuguese', ${query})) DESC
      LIMIT ${limit}
    `;
  }

  /**
   * Similaridade de cosseno real (0 a 1) pra um conjunto especifico de
   * chunks — usado pelo SearchKnowledgeUseCase pra decidir "vazio se
   * score < limiar" com uma metrica de verdade, mesmo pra chunks que
   * entraram no top-5 so pela busca textual (RRF decide ORDEM; esta
   * consulta decide CONFIANCA). Ver comentario em rrf-fusion.ts.
   */
  async getSimilarities(queryEmbedding: number[], chunkIds: string[]): Promise<Map<string, number>> {
    if (chunkIds.length === 0) {
      return new Map();
    }
    const vectorLiteral = toVectorLiteral(queryEmbedding);
    const rows = await this.prisma.$queryRaw<Array<{ chunkId: string; similarity: number }>>`
      SELECT id AS "chunkId", 1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
      FROM "KnowledgeChunk"
      WHERE id IN (${Prisma.join(chunkIds)}) AND embedding IS NOT NULL
    `;
    return new Map(rows.map((row) => [row.chunkId, row.similarity]));
  }

  /** Join simples (sem vetor/tsvector) — via query builder normal do Prisma, nao precisa de SQL cru. */
  async getChunksWithDocument(chunkIds: string[]): Promise<ChunkWithDocument[]> {
    if (chunkIds.length === 0) {
      return [];
    }
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: { id: { in: chunkIds } },
      include: { document: true },
    });
    return chunks.map((chunk) => ({
      chunkId: chunk.id,
      content: chunk.content,
      documentTitle: chunk.document.title,
      sourceRef: chunk.document.sourceRef,
    }));
  }

  /**
   * Cria a nova versao do documento SEM tocar na anterior e SEM ativar —
   * `active:false`, `status:'PENDING'`. A troca so acontece em
   * `activateVersion`, depois que todos os chunks foram inseridos com
   * sucesso (Etapa 5: fecha a janela em que um documento existente ficava
   * ausente da base durante uma reindexacao — a versao anterior, se
   * houver, continua `active:true` e servindo buscas ate la).
   */
  async createDraft(input: {
    title: string;
    category: string;
    sourceRef: string | null;
    content: string;
  }): Promise<{ id: string; version: number }> {
    const latest = input.sourceRef
      ? await this.prisma.knowledgeDocument.findFirst({
          where: { sourceRef: input.sourceRef },
          orderBy: { version: 'desc' },
        })
      : null;

    const created = await this.prisma.knowledgeDocument.create({
      data: {
        title: input.title,
        category: input.category,
        sourceRef: input.sourceRef,
        content: input.content,
        version: (latest?.version ?? 0) + 1,
        active: false,
        status: KnowledgeDocumentStatus.PENDING,
      },
    });

    return { id: created.id, version: created.version };
  }

  /** Troca atomica: so chamado depois que TODOS os chunks da nova versao existem. */
  async activateVersion(documentId: string, sourceRef: string | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (sourceRef) {
        await tx.knowledgeDocument.updateMany({
          where: { sourceRef, active: true, id: { not: documentId } },
          data: { active: false },
        });
      }
      await tx.knowledgeDocument.update({
        where: { id: documentId },
        data: { active: true, status: KnowledgeDocumentStatus.READY, errorMessage: null },
      });
    });
  }

  async markRunning(documentId: string): Promise<void> {
    await this.prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: KnowledgeDocumentStatus.RUNNING },
    });
  }

  async markFailed(documentId: string, errorMessage: string): Promise<void> {
    await this.prisma.knowledgeDocument.update({
      where: { id: documentId },
      data: { status: KnowledgeDocumentStatus.FAILED, errorMessage },
    });
  }

  /** Reset idempotente no inicio de cada tentativa do job — retry nao pode duplicar chunk de tentativa anterior. */
  async deleteChunksForDocument(documentId: string): Promise<void> {
    await this.prisma.knowledgeChunk.deleteMany({ where: { documentId } });
  }

  /** Evita duas trocas atomicas em voo pro mesmo sourceRef (ver ReindexAlreadyPendingError). */
  async hasPendingDraft(sourceRef: string): Promise<boolean> {
    const count = await this.prisma.knowledgeDocument.count({
      where: { sourceRef, status: { in: [KnowledgeDocumentStatus.PENDING, KnowledgeDocumentStatus.RUNNING] } },
    });
    return count > 0;
  }

  async findById(id: string): Promise<KnowledgeDocumentDetail | null> {
    const document = await this.prisma.knowledgeDocument.findUnique({
      where: { id },
      include: { _count: { select: { chunks: true } } },
    });
    if (!document) {
      return null;
    }
    return toDetail(document);
  }

  async listAll(): Promise<KnowledgeDocumentSummary[]> {
    const documents = await this.prisma.knowledgeDocument.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
    });
    return documents.map((document) => toDetail(document));
  }

  /** INSERT cru: embedding e `Unsupported("vector(768)")` no schema, o query builder do Prisma nao aceita esse campo. */
  async insertChunk(input: {
    documentId: string;
    ordinal: number;
    content: string;
    tokenCount: number;
    embedding: number[];
  }): Promise<void> {
    const id = randomUUID();
    const vectorLiteral = toVectorLiteral(input.embedding);
    await this.prisma.$executeRaw`
      INSERT INTO "KnowledgeChunk" (id, "documentId", ordinal, content, "tokenCount", embedding)
      VALUES (${id}, ${input.documentId}, ${input.ordinal}, ${input.content}, ${input.tokenCount}, ${vectorLiteral}::vector)
    `;
  }

  /**
   * Dimensao real da coluna `embedding` no Postgres — pgvector guarda a
   * dimensao de `vector(N)` diretamente em `atttypmod` (confirmado contra
   * o Postgres real, nao suposto). Usado no boot pra validar contra
   * EMBEDDING_DIMENSIONS (ver KnowledgeModule.onModuleInit).
   */
  async getEmbeddingColumnDimensions(): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ dimensions: number }>>`
      SELECT atttypmod AS dimensions
      FROM pg_attribute
      WHERE attrelid = '"KnowledgeChunk"'::regclass AND attname = 'embedding'
    `;
    if (rows.length === 0) {
      throw new Error('Coluna KnowledgeChunk.embedding nao encontrada no Postgres.');
    }
    return rows[0].dimensions;
  }
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

interface DocumentWithChunkCount {
  id: string;
  title: string;
  category: string;
  sourceRef: string | null;
  content: string;
  version: number;
  active: boolean;
  status: KnowledgeDocumentStatus;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { chunks: number };
}

function toDetail(document: DocumentWithChunkCount): KnowledgeDocumentDetail {
  return {
    id: document.id,
    title: document.title,
    category: document.category,
    sourceRef: document.sourceRef,
    content: document.content,
    version: document.version,
    active: document.active,
    status: document.status,
    errorMessage: document.errorMessage,
    chunkCount: document._count.chunks,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { chunkDocument } from '../domain/services/chunker';
import { EmptyDocumentError } from '../domain/errors/empty-document.error';
import { KnowledgeDocumentNotFoundError } from '../domain/errors/knowledge-document-not-found.error';
import { ReindexAlreadyPendingError } from '../domain/errors/reindex-already-pending.error';
import { PrismaKnowledgeRepository } from '../infrastructure/prisma-knowledge.repository';
import { KNOWLEDGE_REINDEX_QUEUE, knowledgeReindexJobId } from '../../../shared/queue/queue.tokens';
import { KNOWLEDGE_REINDEX_ATTEMPTS, KNOWLEDGE_REINDEX_BACKOFF_DELAY_MS } from './reindex-knowledge-document.job';

export interface ReindexDocumentOverrides {
  title?: string;
  category?: string;
  content?: string;
}

export interface ReindexDocumentResult {
  documentId: string;
  version: number;
  status: 'PENDING';
}

/**
 * PUT /api/admin/knowledge/:id (overrides com conteudo/titulo/categoria
 * novos) e POST /api/admin/knowledge/:id/reindex (sem overrides — mesmo
 * conteudo, so rechunk+reembedding) sao o mesmo fluxo: cria uma nova
 * versao rascunho pro mesmo sourceRef e enfileira. Nunca processa na
 * requisicao (ver ReindexKnowledgeDocumentJob).
 */
@Injectable()
export class ReindexDocumentUseCase {
  constructor(
    private readonly knowledge: PrismaKnowledgeRepository,
    @InjectQueue(KNOWLEDGE_REINDEX_QUEUE) private readonly queue: Queue,
  ) {}

  async execute(documentId: string, overrides: ReindexDocumentOverrides = {}): Promise<ReindexDocumentResult> {
    const current = await this.knowledge.findById(documentId);
    if (!current) {
      throw new KnowledgeDocumentNotFoundError();
    }

    const content = overrides.content ?? current.content;
    if (chunkDocument(content).length === 0) {
      throw new EmptyDocumentError();
    }

    if (current.sourceRef && (await this.knowledge.hasPendingDraft(current.sourceRef))) {
      throw new ReindexAlreadyPendingError();
    }

    const draft = await this.knowledge.createDraft({
      title: overrides.title ?? current.title,
      category: overrides.category ?? current.category,
      sourceRef: current.sourceRef,
      content,
    });

    await this.queue.add(
      KNOWLEDGE_REINDEX_QUEUE,
      { documentId: draft.id },
      {
        jobId: knowledgeReindexJobId(draft.id),
        attempts: KNOWLEDGE_REINDEX_ATTEMPTS,
        backoff: { type: 'exponential', delay: KNOWLEDGE_REINDEX_BACKOFF_DELAY_MS },
        removeOnComplete: true,
      },
    );

    return { documentId: draft.id, version: draft.version, status: 'PENDING' };
  }
}

import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { chunkDocument } from '../domain/services/chunker';
import { EmptyDocumentError } from '../domain/errors/empty-document.error';
import { ReindexAlreadyPendingError } from '../domain/errors/reindex-already-pending.error';
import { PrismaKnowledgeRepository } from '../infrastructure/prisma-knowledge.repository';
import { KNOWLEDGE_REINDEX_QUEUE, knowledgeReindexJobId } from '../../../shared/queue/queue.tokens';
import { KNOWLEDGE_REINDEX_ATTEMPTS, KNOWLEDGE_REINDEX_BACKOFF_DELAY_MS } from './reindex-knowledge-document.job';

export interface CreateDocumentInput {
  title: string;
  category: string;
  sourceRef: string | null;
  content: string;
}

export interface CreateDocumentResult {
  documentId: string;
  version: number;
  status: 'PENDING';
}

/**
 * POST /api/admin/knowledge — cria a linha rascunho (rapido, sem chamada
 * de rede) e enfileira o chunking+embedding de verdade. Nunca processa
 * dentro da requisicao (achado do usuario: 1 chamada ao Gemini por chunk,
 * documento grande pode passar de 1 minuto e estourar timeout HTTP).
 */
@Injectable()
export class CreateDocumentUseCase {
  constructor(
    private readonly knowledge: PrismaKnowledgeRepository,
    @InjectQueue(KNOWLEDGE_REINDEX_QUEUE) private readonly queue: Queue,
  ) {}

  async execute(input: CreateDocumentInput): Promise<CreateDocumentResult> {
    if (chunkDocument(input.content).length === 0) {
      throw new EmptyDocumentError();
    }

    if (input.sourceRef && (await this.knowledge.hasPendingDraft(input.sourceRef))) {
      throw new ReindexAlreadyPendingError();
    }

    const draft = await this.knowledge.createDraft(input);

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

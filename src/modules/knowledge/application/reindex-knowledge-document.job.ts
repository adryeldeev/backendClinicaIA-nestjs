import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { KNOWLEDGE_REINDEX_QUEUE } from '../../../shared/queue/queue.tokens';
import { PrismaKnowledgeRepository } from '../infrastructure/prisma-knowledge.repository';
import { ChunkAndEmbedDocumentUseCase } from './chunk-and-embed-document.use-case';

export interface ReindexKnowledgeDocumentJobData {
  documentId: string;
}

// Mesmo espirito do OUTBOX_ATTEMPTS: falha transitoria do provedor de
// embedding (Gemini) nao pode virar FAILED na 1a tentativa.
export const KNOWLEDGE_REINDEX_ATTEMPTS = 5;
export const KNOWLEDGE_REINDEX_BACKOFF_DELAY_MS = 2000;

/**
 * Processa o rascunho criado por CreateDocumentUseCase/ReindexDocumentUseCase
 * (documentId ja existe, `active:false`, `status:'PENDING'`): chunking +
 * embedding (rede, 1 chamada por chunk) + troca atomica. A versao anterior
 * com o mesmo sourceRef, se existir, continua `active:true` e servindo
 * buscas durante todo este processamento — so deixa de servir na mesma
 * transacao que ativa esta (ver PrismaKnowledgeRepository.activateVersion).
 *
 * Reset no inicio de cada tentativa (deleteChunksForDocument): sem isso,
 * um retry depois de falha parcial duplicaria os chunks ja inseridos pela
 * tentativa anterior.
 */
@Processor(KNOWLEDGE_REINDEX_QUEUE)
export class ReindexKnowledgeDocumentJob extends WorkerHost {
  constructor(
    private readonly knowledge: PrismaKnowledgeRepository,
    private readonly chunkAndEmbed: ChunkAndEmbedDocumentUseCase,
  ) {
    super();
  }

  async process(job: Job<ReindexKnowledgeDocumentJobData>): Promise<void> {
    const { documentId } = job.data;
    const document = await this.knowledge.findById(documentId);
    if (!document) {
      throw new Error(`KnowledgeDocument ${documentId} nao encontrado`);
    }

    await this.knowledge.markRunning(documentId);
    await this.knowledge.deleteChunksForDocument(documentId);

    try {
      await this.chunkAndEmbed.execute(documentId, document.content);
      await this.knowledge.activateVersion(documentId, document.sourceRef);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      // job.attemptsMade so e incrementado APOS a falha ser processada
      // pelo BullMQ (mesma convencao do DispatchOutboxJob).
      const attemptsLimit = job.opts.attempts ?? 1;
      const isLastAttempt = job.attemptsMade + 1 >= attemptsLimit;
      if (isLastAttempt) {
        await this.knowledge.markFailed(documentId, reason);
      }

      throw error;
    }
  }
}

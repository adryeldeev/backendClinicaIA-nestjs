import { Injectable, Logger } from '@nestjs/common';
import { chunkDocument } from '../domain/services/chunker';
import { EmptyDocumentError } from '../domain/errors/empty-document.error';
import { PrismaKnowledgeRepository } from '../infrastructure/prisma-knowledge.repository';
import { ChunkAndEmbedDocumentUseCase } from './chunk-and-embed-document.use-case';

export interface IngestDocumentInput {
  title: string;
  category: string;
  sourceRef: string | null;
  content: string;
}

export interface IngestDocumentResult {
  documentId: string;
  version: number;
  chunkCount: number;
}

/**
 * Secao 11 da SPEC.md: chunking -> embedding -> INSERT. Reingestao (mesmo
 * sourceRef) cria uma nova versao e desativa a anterior — nunca apaga.
 * Usado pelo CLI de ingestao (scripts/ingest-knowledge.ts), sincrono (sem
 * timeout de requisicao HTTP pra respeitar).
 *
 * Troca atomica (Etapa 5): a versao nova nasce `active:false` e so vira a
 * versao servida depois que TODOS os chunks foram inseridos com sucesso —
 * nunca existe uma janela em que o documento fica ausente da busca. Mesmo
 * nucleo (ChunkAndEmbedDocumentUseCase) usado por ReindexKnowledgeDocumentJob
 * (painel admin, assincrono).
 */
@Injectable()
export class IngestDocumentUseCase {
  private readonly logger = new Logger(IngestDocumentUseCase.name);

  constructor(
    private readonly chunkAndEmbed: ChunkAndEmbedDocumentUseCase,
    private readonly knowledge: PrismaKnowledgeRepository,
  ) {}

  async execute(input: IngestDocumentInput): Promise<IngestDocumentResult> {
    if (chunkDocument(input.content).length === 0) {
      throw new EmptyDocumentError();
    }

    const { id: documentId, version } = await this.knowledge.createDraft({
      title: input.title,
      category: input.category,
      sourceRef: input.sourceRef,
      content: input.content,
    });

    const { chunkCount } = await this.chunkAndEmbed.execute(documentId, input.content);
    await this.knowledge.activateVersion(documentId, input.sourceRef);

    this.logger.log(`Documento '${input.title}' ingerido: versao ${version}, ${chunkCount} chunk(s).`);

    return { documentId, version, chunkCount };
  }
}

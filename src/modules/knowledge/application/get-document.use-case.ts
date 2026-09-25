import { Injectable } from '@nestjs/common';
import { KnowledgeDocumentNotFoundError } from '../domain/errors/knowledge-document-not-found.error';
import { PrismaKnowledgeRepository, type KnowledgeDocumentDetail } from '../infrastructure/prisma-knowledge.repository';

/** GET /api/admin/knowledge/:id — detalhe + status/erro pro painel dar polling durante a reindexacao. */
@Injectable()
export class GetDocumentUseCase {
  constructor(private readonly knowledge: PrismaKnowledgeRepository) {}

  async execute(id: string): Promise<KnowledgeDocumentDetail> {
    const document = await this.knowledge.findById(id);
    if (!document) {
      throw new KnowledgeDocumentNotFoundError();
    }
    return document;
  }
}

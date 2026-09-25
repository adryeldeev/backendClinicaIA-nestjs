import { Injectable } from '@nestjs/common';
import { PrismaKnowledgeRepository, type KnowledgeDocumentSummary } from '../infrastructure/prisma-knowledge.repository';

/** GET /api/admin/knowledge — todas as versoes, mais recente primeiro (painel decide o que mostrar). */
@Injectable()
export class ListDocumentsUseCase {
  constructor(private readonly knowledge: PrismaKnowledgeRepository) {}

  execute(): Promise<KnowledgeDocumentSummary[]> {
    return this.knowledge.listAll();
  }
}

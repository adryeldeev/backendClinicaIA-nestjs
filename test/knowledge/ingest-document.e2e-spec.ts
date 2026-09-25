import 'reflect-metadata';
import { TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IngestDocumentUseCase } from '../../src/modules/knowledge';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { uniquePhone } from '../support/unique-phone';
import { FakeEmbeddingPort } from './support/fake-embedding-port';
import { bootstrapKnowledgeTestModule } from './support/bootstrap-knowledge-module';

describe('IngestDocumentUseCase', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let ingestDocument: IngestDocumentUseCase;

  beforeAll(async () => {
    moduleRef = await bootstrapKnowledgeTestModule(new FakeEmbeddingPort());
    prisma = moduleRef.get(PrismaService);
    ingestDocument = moduleRef.get(IngestDocumentUseCase);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('ingere um documento: cria KnowledgeDocument e um KnowledgeChunk por pedaco, com embedding', async () => {
    const content = 'Esta e a primeira frase. Esta e a segunda frase. Esta e a terceira frase.';

    const result = await ingestDocument.execute({
      title: 'Politica de atraso',
      category: 'geral',
      sourceRef: `politica-atraso-${uniquePhone()}`,
      content,
    });

    expect(result.chunkCount).toBeGreaterThan(0);

    const document = await prisma.knowledgeDocument.findUnique({ where: { id: result.documentId } });
    expect(document?.active).toBe(true);
    expect(document?.version).toBe(1);

    const chunks = await prisma.knowledgeChunk.findMany({ where: { documentId: result.documentId } });
    expect(chunks).toHaveLength(result.chunkCount);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }
  });

  it('reingestao do mesmo sourceRef cria nova versao e desativa a anterior — nunca apaga', async () => {
    const sourceRef = `preparo-exame-${uniquePhone()}`;

    const first = await ingestDocument.execute({
      title: 'Preparo para exame',
      category: 'preparo_exame',
      sourceRef,
      content: 'Jejum de 8 horas antes do exame.',
    });

    const second = await ingestDocument.execute({
      title: 'Preparo para exame (atualizado)',
      category: 'preparo_exame',
      sourceRef,
      content: 'Jejum de 12 horas antes do exame, conforme nova orientacao.',
    });

    expect(second.documentId).not.toBe(first.documentId);
    expect(second.version).toBe(first.version + 1);

    const oldDocument = await prisma.knowledgeDocument.findUnique({ where: { id: first.documentId } });
    const newDocument = await prisma.knowledgeDocument.findUnique({ where: { id: second.documentId } });

    // Nunca apaga: o documento antigo continua no banco, so desativado.
    expect(oldDocument).not.toBeNull();
    expect(oldDocument?.active).toBe(false);
    expect(newDocument?.active).toBe(true);

    const oldChunksStillExist = await prisma.knowledgeChunk.count({ where: { documentId: first.documentId } });
    expect(oldChunksStillExist).toBeGreaterThan(0);
  });
});

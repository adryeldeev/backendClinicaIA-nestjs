import 'reflect-metadata';
import { TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestSearchUseCase } from '../../src/modules/knowledge';
import { PrismaKnowledgeRepository } from '../../src/modules/knowledge/infrastructure/prisma-knowledge.repository';
import { PrismaService } from '../../src/shared/database/prisma.service';
import type { Env } from '../../src/shared/config/env.schema';
import { FakeEmbeddingPort } from './support/fake-embedding-port';
import { basisVector, bootstrapKnowledgeTestModule } from './support/bootstrap-knowledge-module';

const DIMENSIONS = 768;
const COVERED_QUERY = 'como chegar de onibus na clinica';
const UNCOVERED_QUERY = 'pergunta sem relacao nenhuma com a base';
const COVERED_CHUNK_CONTENT = 'Para chegar de onibus, pegue a linha 010 ate o ponto em frente a clinica.';

/**
 * POST /api/admin/knowledge/test-search (achado do usuario, nao estava na
 * SPEC original): diferente de SearchKnowledgeUseCase, NUNCA corta pelo
 * RAG_SCORE_THRESHOLD — devolve os candidatos com o score real, pro dono
 * da clinica calibrar o texto dos documentos vendo o que foi de fato
 * recuperado, mesmo quando nada passa no limiar atual.
 */
describe('TestSearchUseCase — ferramenta de calibracao (e2e)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let knowledgeRepo: PrismaKnowledgeRepository;
  let testSearch: TestSearchUseCase;
  let configuredThreshold: number;

  beforeAll(async () => {
    const fakeEmbeddings = new FakeEmbeddingPort(
      {
        [COVERED_QUERY]: basisVector(DIMENSIONS, 0),
        [COVERED_CHUNK_CONTENT]: basisVector(DIMENSIONS, 0),
        [UNCOVERED_QUERY]: basisVector(DIMENSIONS, 500),
      },
      DIMENSIONS,
    );

    moduleRef = await bootstrapKnowledgeTestModule(fakeEmbeddings);
    prisma = moduleRef.get(PrismaService);
    knowledgeRepo = moduleRef.get(PrismaKnowledgeRepository);
    testSearch = moduleRef.get(TestSearchUseCase);
    configuredThreshold = moduleRef.get(ConfigService<Env, true>).get('RAG_SCORE_THRESHOLD', { infer: true });

    const document = await prisma.knowledgeDocument.create({
      data: { title: 'Como chegar', category: 'localizacao', content: 'doc de teste', active: true },
    });
    await knowledgeRepo.insertChunk({
      documentId: document.id,
      ordinal: 0,
      content: COVERED_CHUNK_CONTENT,
      tokenCount: 20,
      embedding: basisVector(DIMENSIONS, 0),
    });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('pergunta coberta: candidato aparece com score alto e passesThreshold true', async () => {
    const result = await testSearch.execute(COVERED_QUERY);

    expect(result.threshold).toBe(configuredThreshold);
    expect(result.resultados.length).toBeGreaterThan(0);
    expect(result.resultados[0].conteudo).toBe(COVERED_CHUNK_CONTENT);
    expect(result.resultados[0].score).toBeCloseTo(1, 5);
    expect(result.resultados[0].passesThreshold).toBe(true);
  });

  it('pergunta sem relacao: candidato ainda aparece (nunca lista vazia so por causa do limiar), com passesThreshold false', async () => {
    const result = await testSearch.execute(UNCOVERED_QUERY);

    // Diferenca central com SearchKnowledgeUseCase: la isso seria [].
    expect(result.resultados.length).toBeGreaterThan(0);
    expect(result.resultados[0].passesThreshold).toBe(false);
    expect(result.resultados[0].score).toBeLessThan(result.threshold);
  });
});

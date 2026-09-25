import 'reflect-metadata';
import { TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SearchKnowledgeUseCase } from '../../src/modules/knowledge';
import { PrismaKnowledgeRepository } from '../../src/modules/knowledge/infrastructure/prisma-knowledge.repository';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { FakeEmbeddingPort } from './support/fake-embedding-port';
import { basisVector, bootstrapKnowledgeTestModule } from './support/bootstrap-knowledge-module';

const DIMENSIONS = 768;
const QUERY = 'como chegar de onibus na clinica';
const RELEVANT_CHUNK_CONTENT = 'Para chegar de onibus, pegue a linha 010 ate o ponto em frente a clinica.';
const IRRELEVANT_CHUNK_CONTENT = 'O horario de funcionamento e de segunda a sexta, das 8h as 18h.';

describe('SearchKnowledgeUseCase (busca hibrida RRF)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let knowledgeRepo: PrismaKnowledgeRepository;
  let searchKnowledge: SearchKnowledgeUseCase;
  let fakeEmbeddings: FakeEmbeddingPort;

  beforeAll(async () => {
    // Query e o chunk relevante compartilham o MESMO vetor (basisVector 0)
    // -> similaridade de cosseno exatamente 1.0. O chunk irrelevante usa
    // um vetor ortogonal (basisVector 1) -> similaridade exatamente 0.0.
    // Isso e o que torna RRF/limiar/ranking testaveis de verdade (ver
    // FakeEmbeddingPort) — nao e so "deterministico", e CONTROLADO.
    fakeEmbeddings = new FakeEmbeddingPort(
      {
        [QUERY]: basisVector(DIMENSIONS, 0),
        [RELEVANT_CHUNK_CONTENT]: basisVector(DIMENSIONS, 0),
        [IRRELEVANT_CHUNK_CONTENT]: basisVector(DIMENSIONS, 1),
      },
      DIMENSIONS,
    );

    moduleRef = await bootstrapKnowledgeTestModule(fakeEmbeddings);
    prisma = moduleRef.get(PrismaService);
    knowledgeRepo = moduleRef.get(PrismaKnowledgeRepository);
    searchKnowledge = moduleRef.get(SearchKnowledgeUseCase);

    const document = await prisma.knowledgeDocument.create({
      data: { title: 'Como chegar', category: 'localizacao', content: 'doc de teste', active: true },
    });

    await knowledgeRepo.insertChunk({
      documentId: document.id,
      ordinal: 0,
      content: RELEVANT_CHUNK_CONTENT,
      tokenCount: 20,
      embedding: basisVector(DIMENSIONS, 0),
    });
    await knowledgeRepo.insertChunk({
      documentId: document.id,
      ordinal: 1,
      content: IRRELEVANT_CHUNK_CONTENT,
      tokenCount: 20,
      embedding: basisVector(DIMENSIONS, 1),
    });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('pergunta com correspondencia forte na base devolve o chunk relevante em primeiro, com score alto', async () => {
    const results = await searchKnowledge.execute(QUERY);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].conteudo).toBe(RELEVANT_CHUNK_CONTENT);
    expect(results[0].score).toBeCloseTo(1, 5);
  });

  it('RN (secao 11): pergunta sem correspondencia na base (score abaixo do limiar) devolve lista vazia — nunca o "melhor que tem"', async () => {
    // Vetor ortogonal a TUDO que esta na base (nenhum chunk usa essa posicao).
    const unrelatedQuery = 'pergunta completamente fora de qualquer assunto da base';
    fakeEmbeddings.register(unrelatedQuery, basisVector(DIMENSIONS, 500));

    const results = await searchKnowledge.execute(unrelatedQuery);

    expect(results).toEqual([]);
  });
});

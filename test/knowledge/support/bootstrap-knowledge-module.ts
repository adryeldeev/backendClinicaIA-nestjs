import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { EMBEDDING_PORT, KnowledgeModule, type EmbeddingPort } from '../../../src/modules/knowledge';
import { validateEnv } from '../../../src/shared/config/env.schema';
import { DatabaseModule } from '../../../src/shared/database/database.module';

/** So o que a Fase 4 precisa (knowledge + banco) — nunca chama o Gemini real na suite padrao. */
export async function bootstrapKnowledgeTestModule(embeddingPort: EmbeddingPort): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), DatabaseModule, KnowledgeModule],
  })
    .overrideProvider(EMBEDDING_PORT)
    .useValue(embeddingPort)
    .compile();
}

/** Vetor com 1.0 numa posicao e 0 nas demais — cosseno exato e previsivel (1.0 identico, 0.0 ortogonal). */
export function basisVector(dimensions: number, index: number): number[] {
  const vector = new Array(dimensions).fill(0);
  vector[index] = 1;
  return vector;
}

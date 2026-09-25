import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AgentModule, LLM_PORT, type LlmPort } from '../../../src/modules/agent';
import { EMBEDDING_PORT, type EmbeddingPort } from '../../../src/modules/knowledge';
import { validateEnv } from '../../../src/shared/config/env.schema';
import { DatabaseModule } from '../../../src/shared/database/database.module';
import { QueueModule } from '../../../src/shared/queue/bullmq.module';

/**
 * So o que os testes do orquestrador precisam: agent + a infra
 * compartilhada da qual scheduling/catalog/knowledge dependem por baixo
 * dos panos. Passa `llmPort`/`embeddingPort` pra trocar os adapters reais
 * (Gemini) por fake/scripted ANTES do modulo compilar — nenhum teste toca
 * o Gemini de verdade.
 */
export async function bootstrapAgentTestModule(llmPort?: LlmPort, embeddingPort?: EmbeddingPort): Promise<TestingModule> {
  const builder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      DatabaseModule,
      QueueModule,
      AgentModule,
    ],
  });

  if (llmPort) {
    builder.overrideProvider(LLM_PORT).useValue(llmPort);
  }
  if (embeddingPort) {
    builder.overrideProvider(EMBEDDING_PORT).useValue(embeddingPort);
  }

  return builder.compile();
}

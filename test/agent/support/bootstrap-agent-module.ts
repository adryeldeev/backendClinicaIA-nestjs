import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AgentModule, LLM_PORT, type LlmPort } from '../../../src/modules/agent';
import { EMBEDDING_PORT, type EmbeddingPort } from '../../../src/modules/knowledge';
import { ReindexKnowledgeDocumentJob } from '../../../src/modules/knowledge/application/reindex-knowledge-document.job';
import { ExpireHoldsJob } from '../../../src/modules/scheduling/application/expire-holds.job';
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

  const moduleRef = await builder.compile();

  // .compile() sozinho nao dispara onModuleInit/onApplicationBootstrap —
  // sem isso, WorkerHost.worker nunca e criado (fica "not yet initialized"),
  // entao o resto deste fix (esperar a conexao) nao tem o que esperar.
  await moduleRef.init();

  // Mesmo achado de test/support/wait-for-queues-ready.ts (Etapa 2): fechar
  // o modulo antes da conexao Redis do Worker terminar de conectar gera
  // "Connection is closed" (ioredis) como unhandled rejection — inofensivo
  // localmente (vitest local sempre saiu 0 apesar do ruido), mas derruba o
  // job de CI (exit code 1 mesmo com toda asserção passando). So espera os
  // Workers que EXISTEM neste modulo mais estreito (nao o AppModule
  // completo) — scheduling e knowledge sao os unicos com @Processor
  // alcancaveis a partir de AgentModule (catalog nao tem worker).
  await Promise.all([
    moduleRef.get(ExpireHoldsJob).worker.waitUntilReady(),
    moduleRef.get(ReindexKnowledgeDocumentJob).worker.waitUntilReady(),
  ]);

  return moduleRef;
}

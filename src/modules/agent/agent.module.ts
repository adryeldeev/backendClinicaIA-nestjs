import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { KnowledgeModule } from '../knowledge';
import { SchedulingModule } from '../scheduling';
import { RunOrchestratorTurnUseCase } from './application/run-orchestrator-turn.use-case';
import { ToolRegistry } from './application/tools/tool-registry';
import { GeminiLlmAdapter } from './infrastructure/gemini-llm.adapter';
import { LLM_PORT } from './ports/llm.port';

@Module({
  imports: [CatalogModule, SchedulingModule, KnowledgeModule],
  providers: [
    ToolRegistry,
    RunOrchestratorTurnUseCase,
    { provide: LLM_PORT, useClass: GeminiLlmAdapter },
  ],
  exports: [RunOrchestratorTurnUseCase],
})
export class AgentModule {}

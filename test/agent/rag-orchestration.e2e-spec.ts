import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { TestingModule } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { RunOrchestratorTurnUseCase } from '../../src/modules/agent';
import { FakeEmbeddingPort } from '../knowledge/support/fake-embedding-port';
import { bootstrapAgentTestModule } from './support/bootstrap-agent-module';
import { ScriptedLlmPort } from './support/scripted-llm-port';

function randomContext() {
  return { conversationId: randomUUID(), patientId: randomUUID() };
}

/**
 * Criterios de aceite #7 e #8 (secao 16 da SPEC.md), atravessando
 * agent + knowledge/catalog de verdade — nao so o portao de limiar
 * isolado dentro do modulo knowledge (ja coberto em
 * test/knowledge/search-knowledge.e2e-spec.ts).
 *
 * Limite honesto: ScriptedLlmPort fixa a resposta do "LLM" — isso prova
 * que o CAMINHO MECANICO funciona (tool real chamada, resultado vazio ou
 * com dado real chega correto ao loop, o loop fecha o turno certo), nao
 * que o Gemini de verdade vai sempre escolher a tool certa ou obedecer o
 * prompt. Essa segunda parte e garantia de prompt, validada na mao (ver
 * SPEC.md secao 11), nao testavel automaticamente.
 */
describe('RAG — criterios de aceite #7 e #8 (agent + knowledge/catalog reais)', () => {
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  it(
    'criterio de aceite #7: buscar_conhecimento devolvendo vazio de verdade (busca real, sem correspondencia) ' +
      'fecha o turno com a resposta de "nao tenho essa informacao" — nunca inventa',
    async () => {
      const outOfScopeQuestion = 'pergunta sem nenhuma relacao com qualquer documento da base de conhecimento';
      // Vetor ortogonal a praticamente tudo — garante score real abaixo do
      // limiar na busca vetorial de verdade (ver mesma tecnica em
      // test/knowledge/search-knowledge.e2e-spec.ts).
      const embeddings = new FakeEmbeddingPort({}, 768);
      embeddings.register(outOfScopeQuestion, basisVector(768, 767));

      const llm = new ScriptedLlmPort([
        {
          toolCalls: [
            { id: '1', name: 'buscar_conhecimento', arguments: { pergunta: outOfScopeQuestion } },
          ],
        },
        { text: 'Nao tenho essa informacao no momento. Posso te passar para a recepcao?' },
      ]);

      moduleRef = await bootstrapAgentTestModule(llm, embeddings);
      const orchestrator = moduleRef.get(RunOrchestratorTurnUseCase);

      const result = await orchestrator.execute({
        ...randomContext(),
        history: [],
        newMessages: [outOfScopeQuestion],
      });

      // A tool foi chamada de verdade (busca real no Postgres, nao mock) e
      // devolveu vazio de verdade — e isso que chega pro LLM na 2a chamada.
      const toolResultMessage = llm.receivedInputs[1].messages.find((m) => m.role === 'tool');
      expect(JSON.parse(toolResultMessage!.content)).toEqual({ ok: true, data: [] });

      expect(result).toEqual({
        outcome: 'reply',
        text: 'Nao tenho essa informacao no momento. Posso te passar para a recepcao?',
      });
    },
  );

  it(
    'criterio de aceite #8: pergunta sobre preco e respondida com dado real de tool (catalogo), nao do RAG',
    async () => {
      const llm = new ScriptedLlmPort([
        { toolCalls: [{ id: '1', name: 'listar_procedimentos', arguments: {} }] },
        { text: 'A Consulta Cardiologica custa R$250.' },
      ]);

      moduleRef = await bootstrapAgentTestModule(llm);
      const orchestrator = moduleRef.get(RunOrchestratorTurnUseCase);

      const result = await orchestrator.execute({
        ...randomContext(),
        history: [],
        newMessages: ['quanto custa a consulta com cardiologista?'],
      });

      const toolResultMessage = llm.receivedInputs[1].messages.find((m) => m.role === 'tool');
      const toolResult = JSON.parse(toolResultMessage!.content) as { ok: boolean; data: Array<{ nome: string; precoReais?: number }> };
      expect(toolResult.ok).toBe(true);
      const procedures = toolResult.data;

      // O preco veio de verdade do catalogo (seed real via
      // ListActiveProceduresUseCase) — nunca de um chunk do RAG, que nem
      // foi chamado neste script (a tool so aparece na lista de schemas
      // oferecida ao LLM, nunca nas tool_calls de fato executadas).
      const cardiologica = procedures.find((p) => p.nome === 'Consulta Cardiologica');
      expect(cardiologica?.precoReais).toBe(250);
      expect(llm.callCount).toBe(2); // listar_procedimentos, depois a resposta final — buscar_conhecimento nunca entrou no loop
      expect(result.outcome).toBe('reply');
    },
  );
});

function basisVector(dimensions: number, index: number): number[] {
  const vector = new Array(dimensions).fill(0);
  vector[index] = 1;
  return vector;
}

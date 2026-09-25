import { describe, expect, it } from 'vitest';
import { createBuscarConhecimentoTool } from '../../src/modules/agent/application/tools/buscar-conhecimento.tool';
import type { KnowledgeSearchResult, SearchKnowledgeUseCase } from '../../src/modules/knowledge';

function fakeSearchKnowledge(results: KnowledgeSearchResult[]): SearchKnowledgeUseCase {
  return { execute: async () => results } as unknown as SearchKnowledgeUseCase;
}

describe('buscar_conhecimento tool', () => {
  it('repassa o contrato {conteudo, fonte, score} sem alterar', async () => {
    const results: KnowledgeSearchResult[] = [
      { conteudo: 'Pegue a linha 010 ate a clinica.', fonte: 'Como chegar', score: 0.82 },
    ];
    const tool = createBuscarConhecimentoTool(fakeSearchKnowledge(results));

    const parsed = tool.schema.parse({ pergunta: 'como chego na clinica?' });
    const output = await tool.handler(parsed, {} as never);

    expect(output).toEqual(results);
  });

  it('RN (secao 11): lista vazia passa adiante sem erro — e o sinal de "vazio significa vazio"', async () => {
    const tool = createBuscarConhecimentoTool(fakeSearchKnowledge([]));

    const parsed = tool.schema.parse({ pergunta: 'pergunta sem resposta na base' });
    const output = await tool.handler(parsed, {} as never);

    expect(output).toEqual([]);
  });

  it('respeita topK quando informado', async () => {
    const results: KnowledgeSearchResult[] = [
      { conteudo: 'A', fonte: 'doc', score: 0.9 },
      { conteudo: 'B', fonte: 'doc', score: 0.8 },
      { conteudo: 'C', fonte: 'doc', score: 0.7 },
    ];
    const tool = createBuscarConhecimentoTool(fakeSearchKnowledge(results));

    const parsed = tool.schema.parse({ pergunta: 'pergunta', topK: 2 });
    const output = await tool.handler(parsed, {} as never);

    expect(output).toHaveLength(2);
  });

  it('nunca aceita profissional/preco/convenio como escopo — descricao da tool deixa isso explicito', () => {
    const tool = createBuscarConhecimentoTool(fakeSearchKnowledge([]));
    expect(tool.description).toMatch(/NUNCA usar para preco, convenio, horario/i);
  });
});

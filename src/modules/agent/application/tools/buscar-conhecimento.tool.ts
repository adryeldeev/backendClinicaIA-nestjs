import { z } from 'zod';
import { SearchKnowledgeUseCase } from '../../../knowledge';
import { ToolDefinition } from './tool-definition';

const DEFAULT_TOP_K = 5;

const schema = z.object({
  pergunta: z.string(),
  topK: z.number().int().positive().max(10).optional(),
});

/**
 * Secao 11 da SPEC.md: "Vazio significa vazio. O agente responde que nao
 * tem essa informacao... Nunca preenche a lacuna com conhecimento do
 * modelo." A garantia mecanica (nunca devolver abaixo do limiar) esta em
 * SearchKnowledgeUseCase; esta tool so repassa — devolver [] pro LLM e o
 * sinal que o prompt de sistema precisa reconhecer pra nao inventar.
 */
export function createBuscarConhecimentoTool(
  searchKnowledge: SearchKnowledgeUseCase,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: 'buscar_conhecimento',
    description:
      'Busca informacao textual estavel sobre a clinica (preparo de exame, como chegar, politica de atraso etc). ' +
      'NUNCA usar para preco, convenio, horario disponivel ou nome de profissional — isso vem de outras tools. ' +
      'Lista vazia significa que a base nao tem essa informacao: nunca completar com conhecimento proprio.',
    parameters: {
      type: 'object',
      properties: {
        pergunta: { type: 'string' },
        topK: { type: 'number', description: `Quantos resultados no maximo (padrao ${DEFAULT_TOP_K}).` },
      },
      required: ['pergunta'],
    },
    schema,
    handler: async (args) => {
      const results = await searchKnowledge.execute(args.pergunta);
      return results.slice(0, args.topK ?? DEFAULT_TOP_K);
    },
  };
}

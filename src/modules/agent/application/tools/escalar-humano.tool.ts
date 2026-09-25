import { z } from 'zod';
import { ToolDefinition } from './tool-definition';

export const ESCALATE_TOOL_NAME = 'escalar_humano';

const schema = z.object({ motivo: z.string(), resumo: z.string() });

export interface EscalateToolData {
  escalate: true;
  reason: string;
  summary: string;
}

/**
 * Tool "normal" do ponto de vista do LLM (aparece no schema, tem
 * handler), mas o loop do orquestrador reconhece ESCALATE_TOOL_NAME e
 * curto-circuita em vez de devolver o resultado pro LLM continuar —
 * nao faz sentido pedir mais uma rodada depois que o modelo decidiu
 * escalar.
 */
export function createEscalarHumanoTool(): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: ESCALATE_TOOL_NAME,
    description:
      'Escala a conversa para atendimento humano. Use quando nao puder ajudar com seguranca ou a solicitacao fugir do que voce pode resolver.',
    parameters: {
      type: 'object',
      properties: {
        motivo: { type: 'string', description: 'Motivo curto da escalada' },
        resumo: { type: 'string', description: 'Resumo da conversa para o atendente humano' },
      },
      required: ['motivo', 'resumo'],
    },
    schema,
    handler: async (args): Promise<EscalateToolData> => ({
      escalate: true,
      reason: args.motivo,
      summary: args.resumo,
    }),
  };
}

import type { ZodType } from 'zod';
import type { ToolContext } from '../../domain/tool-result';

export interface ToolDefinition<TArgs = unknown> {
  name: string;
  description: string;
  /** JSON Schema dos parametros, no formato que a API do LLM espera. */
  parameters: Record<string, unknown>;
  /** Validacao real dos argumentos vindos do LLM — nunca confiar sem checar. */
  schema: ZodType<TArgs>;
  handler: (args: TArgs, ctx: ToolContext) => Promise<unknown>;
}

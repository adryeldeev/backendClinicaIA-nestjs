import { z } from 'zod';
import { ListActiveProceduresUseCase } from '../../../catalog';
import { ToolDefinition } from './tool-definition';

const schema = z.object({});

export function createListarProcedimentosTool(
  listActiveProcedures: ListActiveProceduresUseCase,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: 'listar_procedimentos',
    description: 'Lista os procedimentos ativos oferecidos pela clinica.',
    parameters: { type: 'object', properties: {}, required: [] },
    schema,
    handler: async () => {
      const procedures = await listActiveProcedures.execute();
      return procedures.map((procedure) => ({
        id: procedure.id,
        nome: procedure.name,
        duracaoMin: procedure.durationMin,
        precoReais: procedure.priceCents != null ? procedure.priceCents / 100 : undefined,
      }));
    },
  };
}

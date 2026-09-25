import { z } from 'zod';
import { ListActiveProfessionalsUseCase } from '../../../catalog';
import { ToolDefinition } from './tool-definition';

const schema = z.object({ procedimentoId: z.string().optional() });

export function createListarProfissionaisTool(
  listActiveProfessionals: ListActiveProfessionalsUseCase,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: 'listar_profissionais',
    description: 'Lista os profissionais ativos, opcionalmente filtrados por procedimento.',
    parameters: {
      type: 'object',
      properties: { procedimentoId: { type: 'string' } },
      required: [],
    },
    schema,
    handler: async (args) => {
      const professionals = await listActiveProfessionals.execute(args.procedimentoId);
      return professionals.map((professional) => ({
        id: professional.id,
        nome: professional.name,
        especialidade: professional.specialty,
      }));
    },
  };
}

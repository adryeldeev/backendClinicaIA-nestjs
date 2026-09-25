import { z } from 'zod';
import { ListInsurancePlansUseCase } from '../../../catalog';
import { ToolDefinition } from './tool-definition';

const schema = z.object({ nome: z.string().optional() });

export function createConsultarConveniosTool(
  listInsurancePlans: ListInsurancePlansUseCase,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: 'consultar_convenios',
    description: 'Consulta quais convenios a clinica aceita. AD-09: sempre do banco, nunca inventado.',
    parameters: {
      type: 'object',
      properties: { nome: { type: 'string' } },
      required: [],
    },
    schema,
    handler: async (args) => {
      const plans = await listInsurancePlans.execute(args.nome);
      return plans.map((plan) => ({ nome: plan.name, aceito: plan.accepted, observacao: plan.notes }));
    },
  };
}

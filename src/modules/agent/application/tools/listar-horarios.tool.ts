import { z } from 'zod';
import { GetProcedureUseCase, GetProfessionalUseCase } from '../../../catalog';
import { ListOpenSlotsUseCase } from '../../../scheduling';
import { formatDateTimePtBr } from '../../../../shared/kernel/format-datetime-pt-br';
import { ToolDefinition } from './tool-definition';

const MAX_SLOTS_RETURNED = 8;

const schema = z.object({
  profissionalId: z.string(),
  procedimentoId: z.string(),
  dataInicio: z.string(),
  dataFim: z.string(),
});

export function createListarHorariosTool(
  listOpenSlots: ListOpenSlotsUseCase,
  getProfessional: GetProfessionalUseCase,
  getProcedure: GetProcedureUseCase,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: 'listar_horarios',
    description: 'Lista horarios disponiveis de um profissional para um procedimento, num intervalo de datas.',
    parameters: {
      type: 'object',
      properties: {
        profissionalId: { type: 'string' },
        procedimentoId: { type: 'string' },
        dataInicio: { type: 'string', description: 'Data/hora ISO 8601 de inicio do intervalo de busca' },
        dataFim: { type: 'string', description: 'Data/hora ISO 8601 de fim do intervalo de busca' },
      },
      required: ['profissionalId', 'procedimentoId', 'dataInicio', 'dataFim'],
    },
    schema,
    handler: async (args) => {
      const [professional] = await Promise.all([
        getProfessional.execute(args.profissionalId),
        getProcedure.execute(args.procedimentoId), // valida que existe; a duracao e usada dentro de listOpenSlots
      ]);

      const slots = await listOpenSlots.execute({
        professionalId: args.profissionalId,
        procedureId: args.procedimentoId,
        fromUtc: new Date(args.dataInicio),
        toUtc: new Date(args.dataFim),
      });

      return slots.slice(0, MAX_SLOTS_RETURNED).map((slot) => ({
        startsAt: slot.startsAt.toISOString(),
        label: formatDateTimePtBr(slot.startsAt, professional.clinicTimezone),
      }));
    },
  };
}

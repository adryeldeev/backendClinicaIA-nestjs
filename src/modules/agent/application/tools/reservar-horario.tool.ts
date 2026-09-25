import { z } from 'zod';
import { HoldSlotUseCase } from '../../../scheduling';
import { ToolDefinition } from './tool-definition';

const schema = z.object({
  profissionalId: z.string(),
  procedimentoId: z.string(),
  startsAt: z.string(),
});

export function createReservarHorarioTool(
  holdSlot: HoldSlotUseCase,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: 'reservar_horario',
    description:
      'Reserva temporariamente um horario (HELD) para o paciente atual. Precisa ser confirmado depois com confirmar_agendamento — a reserva expira sozinha se nao for confirmada a tempo.',
    parameters: {
      type: 'object',
      properties: {
        profissionalId: { type: 'string' },
        procedimentoId: { type: 'string' },
        startsAt: { type: 'string', description: 'Data/hora ISO 8601 do horario escolhido (deve vir de listar_horarios)' },
      },
      required: ['profissionalId', 'procedimentoId', 'startsAt'],
    },
    schema,
    handler: async (args, ctx) => {
      const result = await holdSlot.execute({
        professionalId: args.profissionalId,
        procedureId: args.procedimentoId,
        patientId: ctx.patientId, // RN-14: contexto do servidor, nunca do LLM
        startsAt: new Date(args.startsAt),
        createdBy: 'agent',
      });
      return { holdId: result.appointmentId, expiraEm: result.holdExpiresAt.toISOString() };
    },
  };
}

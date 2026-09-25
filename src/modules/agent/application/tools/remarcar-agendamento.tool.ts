import { z } from 'zod';
import { RescheduleAppointmentUseCase } from '../../../scheduling';
import { ToolDefinition } from './tool-definition';

const schema = z.object({ appointmentId: z.string(), novoStartsAt: z.string() });

export function createRemarcarAgendamentoTool(
  rescheduleAppointment: RescheduleAppointmentUseCase,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: 'remarcar_agendamento',
    description:
      'Remarca uma consulta existente do paciente atual para um novo horario. Se o novo horario nao estiver disponivel, a consulta original permanece intacta.',
    parameters: {
      type: 'object',
      properties: {
        appointmentId: { type: 'string' },
        novoStartsAt: { type: 'string', description: 'Data/hora ISO 8601 do novo horario' },
      },
      required: ['appointmentId', 'novoStartsAt'],
    },
    schema,
    handler: async (args, ctx) => {
      const result = await rescheduleAppointment.execute({
        appointmentId: args.appointmentId,
        patientId: ctx.patientId,
        newStartsAt: new Date(args.novoStartsAt),
      });
      return { appointmentId: result.appointmentId };
    },
  };
}

import { z } from 'zod';
import { ConfirmAppointmentUseCase } from '../../../scheduling';
import { ToolDefinition } from './tool-definition';

const schema = z.object({ holdId: z.string() });

export function createConfirmarAgendamentoTool(
  confirmAppointment: ConfirmAppointmentUseCase,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: 'confirmar_agendamento',
    description:
      'Confirma um horario reservado (HELD -> CONFIRMED). So chame depois que o paciente confirmar explicitamente (RN-09) — nao chame por silencio ou resposta ambigua.',
    parameters: {
      type: 'object',
      properties: { holdId: { type: 'string' } },
      required: ['holdId'],
    },
    schema,
    handler: async (args) => {
      const result = await confirmAppointment.execute(args.holdId);
      return { appointmentId: result.appointmentId, resumo: 'Consulta confirmada.' };
    },
  };
}

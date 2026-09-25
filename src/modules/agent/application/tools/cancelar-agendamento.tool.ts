import { z } from 'zod';
import { CancelAppointmentUseCase } from '../../../scheduling';
import { ToolDefinition } from './tool-definition';

const schema = z.object({ appointmentId: z.string(), motivo: z.string().optional() });

export function createCancelarAgendamentoTool(
  cancelAppointment: CancelAppointmentUseCase,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: 'cancelar_agendamento',
    description: 'Cancela uma consulta do paciente atual.',
    parameters: {
      type: 'object',
      properties: {
        appointmentId: { type: 'string' },
        motivo: { type: 'string' },
      },
      required: ['appointmentId'],
    },
    schema,
    handler: async (args, ctx) => {
      // RN-14: patientId do contexto — o caso de uso recusa se a consulta
      // nao pertencer a este paciente.
      await cancelAppointment.execute({
        appointmentId: args.appointmentId,
        patientId: ctx.patientId,
        reason: args.motivo,
      });
      return { ok: true };
    },
  };
}

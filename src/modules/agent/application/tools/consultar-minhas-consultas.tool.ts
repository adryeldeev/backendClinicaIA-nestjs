import { z } from 'zod';
import { ListPatientAppointmentsUseCase } from '../../../scheduling';
import { ToolDefinition } from './tool-definition';

const schema = z.object({});

export function createConsultarMinhasConsultasTool(
  listPatientAppointments: ListPatientAppointmentsUseCase,
): ToolDefinition<z.infer<typeof schema>> {
  return {
    name: 'consultar_minhas_consultas',
    description: 'Lista as consultas futuras e confirmadas do paciente atual.',
    parameters: { type: 'object', properties: {}, required: [] },
    schema,
    handler: async (_args, ctx) => {
      const appointments = await listPatientAppointments.execute(ctx.patientId);
      return appointments.map((appointment) => ({
        id: appointment.id,
        profissional: appointment.professionalName,
        quando: appointment.startsAt.toISOString(),
        status: appointment.status,
      }));
    },
  };
}

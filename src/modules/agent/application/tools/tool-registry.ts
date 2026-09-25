import { Injectable } from '@nestjs/common';
import {
  GetProcedureUseCase,
  GetProfessionalUseCase,
  ListActiveProceduresUseCase,
  ListActiveProfessionalsUseCase,
  ListInsurancePlansUseCase,
} from '../../../catalog';
import { SearchKnowledgeUseCase } from '../../../knowledge';
import {
  CancelAppointmentUseCase,
  ConfirmAppointmentUseCase,
  HoldSlotUseCase,
  ListOpenSlotsUseCase,
  ListPatientAppointmentsUseCase,
  RescheduleAppointmentUseCase,
} from '../../../scheduling';
import type { ToolSchema } from '../../ports/llm.port';
import { createBuscarConhecimentoTool } from './buscar-conhecimento.tool';
import { createCancelarAgendamentoTool } from './cancelar-agendamento.tool';
import { createConfirmarAgendamentoTool } from './confirmar-agendamento.tool';
import { createConsultarConveniosTool } from './consultar-convenios.tool';
import { createConsultarMinhasConsultasTool } from './consultar-minhas-consultas.tool';
import { createEscalarHumanoTool } from './escalar-humano.tool';
import { createListarHorariosTool } from './listar-horarios.tool';
import { createListarProcedimentosTool } from './listar-procedimentos.tool';
import { createListarProfissionaisTool } from './listar-profissionais.tool';
import { createReservarHorarioTool } from './reservar-horario.tool';
import { createRemarcarAgendamentoTool } from './remarcar-agendamento.tool';
import { ToolDefinition } from './tool-definition';

@Injectable()
export class ToolRegistry {
  private readonly tools: Map<string, ToolDefinition>;

  constructor(
    listActiveProcedures: ListActiveProceduresUseCase,
    listActiveProfessionals: ListActiveProfessionalsUseCase,
    listInsurancePlans: ListInsurancePlansUseCase,
    getProfessional: GetProfessionalUseCase,
    getProcedure: GetProcedureUseCase,
    listOpenSlots: ListOpenSlotsUseCase,
    holdSlot: HoldSlotUseCase,
    confirmAppointment: ConfirmAppointmentUseCase,
    cancelAppointment: CancelAppointmentUseCase,
    rescheduleAppointment: RescheduleAppointmentUseCase,
    listPatientAppointments: ListPatientAppointmentsUseCase,
    searchKnowledge: SearchKnowledgeUseCase,
  ) {
    // Cada create*Tool() devolve um ToolDefinition<TArgs especifico> —
    // schema e handler sempre andam pareados dentro de cada factory, entao
    // o erasure pra armazenamento heterogeneo aqui e seguro por construcao
    // (executeTool sempre valida com tool.schema antes de chamar
    // tool.handler com o resultado). Um unico "as" no ponto exato onde a
    // erasure e intencional, em vez de "any" espalhado.
    const definitions = [
      createListarProcedimentosTool(listActiveProcedures),
      createListarProfissionaisTool(listActiveProfessionals),
      createListarHorariosTool(listOpenSlots, getProfessional, getProcedure),
      createReservarHorarioTool(holdSlot),
      createConfirmarAgendamentoTool(confirmAppointment),
      createCancelarAgendamentoTool(cancelAppointment),
      createRemarcarAgendamentoTool(rescheduleAppointment),
      createConsultarMinhasConsultasTool(listPatientAppointments),
      createConsultarConveniosTool(listInsurancePlans),
      createBuscarConhecimentoTool(searchKnowledge),
      createEscalarHumanoTool(),
    ] as ToolDefinition[];

    this.tools = new Map(definitions.map((tool) => [tool.name, tool]));
  }

  getSchemas(): ToolSchema[] {
    return Array.from(this.tools.values()).map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    }));
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }
}

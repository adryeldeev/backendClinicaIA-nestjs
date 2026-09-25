import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { TestingModule } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { HistoryMessage, RunOrchestratorTurnUseCase } from '../../src/modules/agent';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { bootstrapAgentTestModule } from './support/bootstrap-agent-module';
import { ScriptedLlmPort } from './support/scripted-llm-port';

/**
 * Pedido explicito do usuario (2026-09-24): "o custo de operacao do
 * sistema inteiro e chamada ao LLM. Um teste que falha quando uma
 * conversa completa passa de N chamadas e o que impede uma mudanca de
 * prompt ou de orquestrador dobrar a conta sem ninguem perceber."
 *
 * Roda o orquestrador real (RunOrchestratorTurnUseCase), com os 5 tool
 * handlers reais de agendamento contra Postgres de teste real
 * (listar_procedimentos -> listar_profissionais -> listar_horarios ->
 * reservar_horario -> confirmar_agendamento), ate o Appointment chegar em
 * CONFIRMED de verdade. So o LLM em si e scriptado — impossivel rodar o
 * Gemini real em teste, convencao ja estabelecida no projeto (ver
 * ScriptedLlmPort).
 *
 * O script abaixo e o CAMINHO MAIS DIRETO possivel: uma tool por turno do
 * paciente, sem retentativa de guardrail de saida (RN-03), sem argumento
 * invalido, sem pedido ambiguo, sem hesitacao/correcao do paciente. Medido
 * em 2026-09-24: 5 turnos, 2 chamadas por turno, 10 no total — esse e o
 * PISO, nao uma media. Este teste fixa esse piso como orcamento: se um dia
 * passar de 10 sem ninguem mudar este numero conscientemente, alguma
 * mudanca de prompt/orquestrador tornou a conversa mais cara e precisa ser
 * vista, nao passar batido.
 *
 * Se um dia esse numero PRECISAR subir por uma razao legitima (nova regra
 * de negocio, novo passo obrigatorio), o ajuste e consciente: sobe o
 * `LLM_CALL_BUDGET` abaixo, documentando o motivo — nunca aumenta em
 * silencio so pra fazer o teste passar.
 */
const LLM_CALL_BUDGET = 10;

describe('Orcamento de chamadas ao LlmPort — conversa completa de agendamento (achado do usuario, 2026-09-24)', () => {
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  it(`do "oi" ate a consulta CONFIRMED, no caminho mais direto, nunca passa de ${LLM_CALL_BUDGET} chamadas ao LlmPort`, async () => {
    const llm = new ScriptedLlmPort([{ text: 'placeholder' }]); // sobrescrito por turno abaixo
    moduleRef = await bootstrapAgentTestModule(llm);
    const orchestrator = moduleRef.get(RunOrchestratorTurnUseCase);
    const prisma = moduleRef.get(PrismaService);

    const clinic = await prisma.clinic.create({
      data: { name: `Clinica Orcamento LLM ${randomUUID()}`, timezone: 'America/Fortaleza', addressLine: 'x', phone: `+${Date.now()}` },
    });
    const professional = await prisma.professional.create({
      data: { clinicId: clinic.id, name: 'Prof Orcamento LLM', specialty: 'Geral' },
    });
    const procedure = await prisma.procedure.create({
      data: { clinicId: clinic.id, name: 'Procedimento Orcamento LLM', durationMin: 30 },
    });
    const startsAt = new Date();
    startsAt.setUTCDate(startsAt.getUTCDate() + 5);
    startsAt.setUTCHours(14, 0, 0, 0);
    await prisma.availabilityRule.create({
      data: { professionalId: professional.id, weekday: startsAt.getUTCDay(), startTime: '00:00', endTime: '23:30', slotMinutes: 30 },
    });
    const patient = await prisma.patient.create({ data: { phoneE164: `+${Date.now()}9`, name: 'Paciente Orcamento LLM' } });

    const conversationId = randomUUID();
    const history: HistoryMessage[] = [];
    const turnCounts: number[] = [];

    async function runTurn(patientMessage: string, script: ConstructorParameters<typeof ScriptedLlmPort>[0]) {
      llm.setScript(script);
      history.push({ role: 'PATIENT', content: patientMessage });
      const result = await orchestrator.execute({
        conversationId,
        patientId: patient.id,
        history: history.slice(0, -1),
        newMessages: [patientMessage],
      });
      if (result.outcome !== 'reply') {
        throw new Error(`Turno escalou inesperadamente: ${JSON.stringify(result)}`);
      }
      history.push({ role: 'AGENT', content: result.text });
      turnCounts.push(llm.callCount);
      return result.text;
    }

    // Turno 1: paciente pede pra marcar. Agente lista procedimentos, pergunta qual.
    await runTurn('Oi, quero marcar uma consulta', [
      { toolCalls: [{ id: '1', name: 'listar_procedimentos', arguments: {} }] },
      { text: 'Temos algumas opcoes de procedimento disponiveis. Qual voce prefere?' },
    ]);

    // Turno 2: paciente escolhe o procedimento. Agente lista profissionais, pergunta qual.
    await runTurn('Procedimento Orcamento LLM', [
      { toolCalls: [{ id: '1', name: 'listar_profissionais', arguments: { procedimentoId: procedure.id } }] },
      { text: 'Temos um profissional disponivel para esse procedimento. Prosseguir com ele?' },
    ]);

    // Turno 3: paciente confirma o profissional. Agente lista horarios, pergunta qual.
    await runTurn('Sim, pode ser', [
      {
        toolCalls: [
          {
            id: '1',
            name: 'listar_horarios',
            arguments: {
              profissionalId: professional.id,
              procedimentoId: procedure.id,
              dataInicio: new Date().toISOString(),
              dataFim: new Date(startsAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            },
          },
        ],
      },
      { text: 'Encontrei horarios disponiveis. Algum deles serve?' },
    ]);

    // Turno 4: paciente escolhe o horario. Agente reserva (HELD), pede confirmacao final.
    await runTurn('Pode ser esse mesmo', [
      {
        toolCalls: [
          {
            id: '1',
            name: 'reservar_horario',
            arguments: { profissionalId: professional.id, procedimentoId: procedure.id, startsAt: startsAt.toISOString() },
          },
        ],
      },
      { text: 'Reservei esse horario para voce. Posso confirmar definitivamente?' },
    ]);

    // Turno 5: paciente confirma. Agente efetiva (CONFIRMED).
    const appointmentBefore = await prisma.appointment.findFirst({ where: { patientId: patient.id } });
    await runTurn('Sim, confirma', [
      { toolCalls: [{ id: '1', name: 'confirmar_agendamento', arguments: { holdId: appointmentBefore!.id } }] },
      { text: 'Prontinho, sua consulta esta confirmada!' },
    ]);

    const appointmentAfter = await prisma.appointment.findUnique({ where: { id: appointmentBefore!.id } });
    expect(appointmentAfter?.status).toBe('CONFIRMED');

    const total = turnCounts.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(LLM_CALL_BUDGET);
  });
});

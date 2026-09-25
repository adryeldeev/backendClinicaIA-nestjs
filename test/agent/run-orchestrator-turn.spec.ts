import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { TestingModule } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { RunOrchestratorTurnUseCase } from '../../src/modules/agent';
import { bootstrapAgentTestModule } from './support/bootstrap-agent-module';
import { ScriptedLlmPort } from './support/scripted-llm-port';

describe('RunOrchestratorTurnUseCase', () => {
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  async function setup(llm: ScriptedLlmPort) {
    moduleRef = await bootstrapAgentTestModule(llm);
    return moduleRef.get(RunOrchestratorTurnUseCase);
  }

  function randomContext() {
    return { conversationId: randomUUID(), patientId: randomUUID() };
  }

  it('caminho feliz: LLM devolve texto direto, sem tool call', async () => {
    const llm = new ScriptedLlmPort([{ text: 'Oi! Como posso ajudar?' }]);
    const orchestrator = await setup(llm);

    const result = await orchestrator.execute({
      ...randomContext(),
      history: [],
      newMessages: ['oi'],
    });

    expect(result).toEqual({ outcome: 'reply', text: 'Oi! Como posso ajudar?' });
    expect(llm.callCount).toBe(1);
  });

  it('rotina, nao excecao: tool que nao existe vira {ok:false} e o loop continua', async () => {
    const llm = new ScriptedLlmPort([
      { toolCalls: [{ id: '1', name: 'tool_que_nao_existe', arguments: {} }] },
      { text: 'Entendido.' },
    ]);
    const orchestrator = await setup(llm);

    const result = await orchestrator.execute({
      ...randomContext(),
      history: [],
      newMessages: ['oi'],
    });

    expect(result).toEqual({ outcome: 'reply', text: 'Entendido.' });
    expect(llm.callCount).toBe(2); // o loop continuou pra uma segunda chamada

    const secondCallMessages = llm.receivedInputs[1].messages;
    const toolResultMessage = secondCallMessages.find((m) => m.role === 'tool');
    expect(toolResultMessage?.content).toContain('nao existe');
  });

  it('rotina, nao excecao: argumentos invalidos (Zod) viram {ok:false} e o loop continua', async () => {
    const llm = new ScriptedLlmPort([
      // reservar_horario exige profissionalId/procedimentoId/startsAt — nenhum enviado
      { toolCalls: [{ id: '1', name: 'reservar_horario', arguments: {} }] },
      { text: 'Certo, vou verificar outro horario.' },
    ]);
    const orchestrator = await setup(llm);

    const result = await orchestrator.execute({
      ...randomContext(),
      history: [],
      newMessages: ['quero marcar as 10h'],
    });

    expect(result.outcome).toBe('reply');
    const toolResultMessage = llm.receivedInputs[1].messages.find((m) => m.role === 'tool');
    expect(toolResultMessage?.content).toContain('Argumentos invalidos');
  });

  it(
    'rotina, nao excecao: handler que lanca erro de dominio conhecido (AppointmentNotFoundError) ' +
      'vira {ok:false} com mensagem amigavel, nunca derruba o job',
    async () => {
      const fakeHoldId = randomUUID();
      const llm = new ScriptedLlmPort([
        { toolCalls: [{ id: '1', name: 'confirmar_agendamento', arguments: { holdId: fakeHoldId } }] },
        { text: 'Nao encontrei essa reserva, vamos tentar de novo.' },
      ]);
      const orchestrator = await setup(llm);

      const result = await orchestrator.execute({
        ...randomContext(),
        history: [],
        newMessages: ['pode confirmar?'],
      });

      expect(result.outcome).toBe('reply');
      const toolResultMessage = llm.receivedInputs[1].messages.find((m) => m.role === 'tool');
      expect(toolResultMessage?.content).toContain('não encontrada');
      // nunca vaza detalhe interno tipo stack trace
      expect(toolResultMessage?.content).not.toContain('at ');
    },
  );

  it('LLM_MAX_ITERATIONS: se o modelo so pede tool call e nunca conclui, o loop escala em vez de rodar pra sempre', async () => {
    // Script de tamanho 1 com tool call — ScriptedLlmPort repete a ultima
    // resposta indefinidamente, entao isso forca o loop a bater no teto.
    const llm = new ScriptedLlmPort([
      { toolCalls: [{ id: '1', name: 'listar_procedimentos', arguments: {} }] },
    ]);
    const orchestrator = await setup(llm);

    const result = await orchestrator.execute({
      ...randomContext(),
      history: [],
      newMessages: ['quais procedimentos voces tem?'],
    });

    expect(result).toEqual({
      outcome: 'escalate',
      reason: 'max_iterations',
      summary: expect.stringContaining('5 passos'),
    });
    expect(llm.callCount).toBe(5); // LLM_MAX_ITERATIONS do .env
  });

  it('falha do proprio LlmPort (rede, resposta ilegivel) escala em vez de derrubar o job', async () => {
    const llm = new ScriptedLlmPort([{ throws: new Error('rede indisponivel') }]);
    const orchestrator = await setup(llm);

    const result = await orchestrator.execute({
      ...randomContext(),
      history: [],
      newMessages: ['oi'],
    });

    expect(result).toEqual({
      outcome: 'escalate',
      reason: 'llm_error',
      summary: expect.stringContaining('rede indisponivel'),
    });
  });

  it('guardrail de entrada (RN-02) curto-circuita antes de qualquer chamada ao LLM', async () => {
    const llm = new ScriptedLlmPort([{ text: 'isso nunca deveria ser chamado' }]);
    const orchestrator = await setup(llm);

    const result = await orchestrator.execute({
      ...randomContext(),
      history: [],
      newMessages: ['estou com uma dor muito forte no peito'],
    });

    expect(result.outcome).toBe('escalate');
    if (result.outcome === 'escalate') {
      expect(result.reason).toBe('RN-02');
    }
    expect(llm.callCount).toBe(0);
  });

  it('RN-03 (guardrail de saida): resposta com preco nao autorizado regenera uma vez e aceita a correcao', async () => {
    const llm = new ScriptedLlmPort([
      { toolCalls: [{ id: '1', name: 'listar_procedimentos', arguments: {} }] },
      { text: 'A consulta cardiologica custa R$999 — valor inventado, nao veio de tool.' },
      { text: 'A Consulta Cardiologica custa o valor que aparece no nosso catalogo. Posso te ajudar a agendar?' },
    ]);
    const orchestrator = await setup(llm);

    const result = await orchestrator.execute({
      ...randomContext(),
      history: [],
      newMessages: ['quanto custa a consulta com cardiologista?'],
    });

    expect(result).toEqual({
      outcome: 'reply',
      text: 'A Consulta Cardiologica custa o valor que aparece no nosso catalogo. Posso te ajudar a agendar?',
    });
    expect(llm.callCount).toBe(3); // tool call, resposta rejeitada, resposta corrigida
  });

  it(
    'RN-03 (guardrail de saida): rejeitado duas vezes escala com reason RN-03 — ' +
      'NAO cai no caminho especial de llm_error (falha de comportamento, nao de infraestrutura)',
    async () => {
      const llm = new ScriptedLlmPort([
        { toolCalls: [{ id: '1', name: 'listar_procedimentos', arguments: {} }] },
        { text: 'Custa R$999, valor inventado.' },
        { text: 'Ainda assim, custa R$999 — continuo inventando o valor.' },
      ]);
      const orchestrator = await setup(llm);

      const result = await orchestrator.execute({
        ...randomContext(),
        history: [],
        newMessages: ['quanto custa a consulta com cardiologista?'],
      });

      expect(result.outcome).toBe('escalate');
      if (result.outcome === 'escalate') {
        expect(result.reason).toBe('RN-03');
        expect(result.reason).not.toBe('llm_error');
        expect(result.summary).toContain('999');
      }
      expect(llm.callCount).toBe(3); // nao regenera uma terceira vez
    },
  );

  it('tool escalar_humano curto-circuita o loop — nao volta pro LLM depois', async () => {
    const llm = new ScriptedLlmPort([
      {
        toolCalls: [
          {
            id: '1',
            name: 'escalar_humano',
            arguments: { motivo: 'pedido fora do escopo', resumo: 'paciente pediu algo que o bot nao resolve' },
          },
        ],
      },
      { text: 'isso nunca deveria ser chamado' },
    ]);
    const orchestrator = await setup(llm);

    const result = await orchestrator.execute({
      ...randomContext(),
      history: [],
      newMessages: ['isso aqui e algo bem fora do escopo'],
    });

    expect(result).toEqual({
      outcome: 'escalate',
      reason: 'pedido fora do escopo',
      summary: 'paciente pediu algo que o bot nao resolve',
    });
    expect(llm.callCount).toBe(1); // nao chamou o LLM de novo depois da tool
  });
});

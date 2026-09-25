import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../shared/config/env.schema';
import { redactForLog } from '../../../shared/kernel/redact-pii';
import { checkInputGuardrail } from '../domain/guardrails/input-guardrail';
import {
  checkOutputGuardrail,
  collectAuthorizedFacts,
  createAuthorizedFacts,
} from '../domain/guardrails/output-guardrail';
import type { ToolContext, ToolResult } from '../domain/tool-result';
import { LLM_PORT, LlmMessage, LlmPort, ToolCall } from '../ports/llm.port';
import { SYSTEM_PROMPT } from './prompts/system-prompt';
import { ESCALATE_TOOL_NAME, EscalateToolData } from './tools/escalar-humano.tool';
import { ToolRegistry } from './tools/tool-registry';

export interface HistoryMessage {
  role: 'PATIENT' | 'AGENT' | 'HUMAN' | 'SYSTEM';
  content: string;
}

export interface OrchestratorTurnInput {
  conversationId: string;
  patientId: string;
  /** Ultimos turnos ja fechados, em ordem cronologica. */
  history: HistoryMessage[];
  /**
   * TODAS as mensagens do paciente ainda nao processadas neste turno —
   * nao so a ultima. Ver decisao 1 do plano da Fase 3: a spec original
   * tinha `run(conversation, userMessage: string)`, que perderia
   * mensagens quando o debounce colapsa varias em uma execucao.
   */
  newMessages: string[];
}

export type OrchestratorTurnResult =
  | { outcome: 'reply'; text: string }
  | { outcome: 'escalate'; reason: string; summary: string };

function toLlmRole(role: HistoryMessage['role']): 'user' | 'assistant' {
  return role === 'PATIENT' ? 'user' : 'assistant';
}

function toFriendlyMessage(error: unknown): string {
  // Erros de dominio (SlotTakenError, HoldExpiredError, etc.) ja tem
  // mensagem amigavel no proprio Error#message — nunca vazamos stack
  // trace nem detalhe interno pro LLM.
  if (error instanceof Error) {
    return error.message;
  }
  return 'Ocorreu um erro inesperado ao executar essa acao.';
}

@Injectable()
export class RunOrchestratorTurnUseCase {
  private readonly logger = new Logger(RunOrchestratorTurnUseCase.name);

  constructor(
    @Inject(LLM_PORT) private readonly llm: LlmPort,
    private readonly tools: ToolRegistry,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async execute(input: OrchestratorTurnInput): Promise<OrchestratorTurnResult> {
    // Guardrail de entrada (RN-01/RN-02) — roda ANTES de qualquer chamada
    // ao LLM. Antecipado da Fase 5 (ver SPEC.md secao 15).
    const guardrail = checkInputGuardrail(input.newMessages);
    if (guardrail.triggered) {
      this.logger.warn(
        `Guardrail de entrada ${guardrail.reason} acionado na conversa ${input.conversationId}.`,
      );
      return { outcome: 'escalate', reason: guardrail.reason, summary: guardrail.summary };
    }

    const toolContext: ToolContext = {
      conversationId: input.conversationId,
      patientId: input.patientId,
    };

    const messages: LlmMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...input.history.map((message) => ({ role: toLlmRole(message.role), content: message.content })),
      { role: 'user', content: input.newMessages.join('\n') },
    ];

    const maxIterations = this.config.get('LLM_MAX_ITERATIONS', { infer: true });
    // RN-03 (guardrail de saida, secao 13 da SPEC.md): fatos "autorizados"
    // (nome/valor) crescem durante o turno inteiro, nunca reiniciam a cada
    // iteracao — e estado do turno, nao filtro de texto isolado.
    const authorizedFacts = createAuthorizedFacts();
    let outputGuardrailRetried = false;

    for (let i = 0; i < maxIterations; i++) {
      let completion;
      try {
        completion = await this.llm.complete({ messages, tools: this.tools.getSchemas() });
      } catch (error) {
        // Nunca deixa o job cair por causa de uma falha do LLM (rede,
        // resposta ilegivel etc.) — escala em vez de propagar.
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.error(`LlmPort.complete falhou na conversa ${input.conversationId}: ${reason}`);
        return {
          outcome: 'escalate',
          reason: 'llm_error',
          summary: `Falha ao consultar o modelo de linguagem: ${reason}`,
        };
      }

      if (!completion.toolCalls?.length) {
        const replyText = completion.text ?? '';
        const guardrailVerdict = checkOutputGuardrail(replyText, authorizedFacts);

        if (!guardrailVerdict.violated) {
          return { outcome: 'reply', text: replyText };
        }

        this.logger.warn(
          `Guardrail de saida (RN-03) acionado na conversa ${input.conversationId}: ${redactForLog(guardrailVerdict.unauthorizedMentions.join(', '))}`,
        );

        if (outputGuardrailRetried) {
          return {
            outcome: 'escalate',
            reason: 'RN-03',
            summary: `Resposta gerada citou informacao nao confirmada por tool nesta conversa: ${guardrailVerdict.unauthorizedMentions.join(', ')}`,
          };
        }

        // Regenera uma vez so (secao 13 da SPEC.md) — NAO consome o
        // orcamento de LLM_MAX_ITERATIONS, que e sobre chamadas de tool,
        // nao sobre isso. `i--` neutraliza o incremento do for pra essa
        // tentativa nao contar no limite.
        outputGuardrailRetried = true;
        messages.push({ role: 'assistant', content: replyText });
        messages.push({
          role: 'user',
          content:
            'Sua resposta anterior mencionou informacao que nao veio de nenhuma tool confirmada nesta conversa. ' +
            'Responda de novo usando so nomes e valores que vieram de resultado de tool.',
        });
        i--;
        continue;
      }

      messages.push({
        role: 'assistant',
        content: completion.text ?? '',
        toolCalls: completion.toolCalls,
      });

      for (const call of completion.toolCalls) {
        const result = await this.executeTool(call, toolContext);

        // escalar_humano curto-circuita o loop — nao volta pro LLM.
        if (call.name === ESCALATE_TOOL_NAME && result.ok) {
          const data = result.data as EscalateToolData;
          return { outcome: 'escalate', reason: data.reason, summary: data.summary };
        }

        if (result.ok) {
          collectAuthorizedFacts(result.data, authorizedFacts);
        }

        messages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: JSON.stringify(result),
        });
      }
    }

    this.logger.warn(`Conversa ${input.conversationId} nao convergiu em ${maxIterations} iteracoes.`);
    return {
      outcome: 'escalate',
      reason: 'max_iterations',
      summary: `O agente nao conseguiu resolver a solicitacao em ${maxIterations} passos.`,
    };
  }

  /**
   * Nunca lanca. Tool inexistente, argumento invalido, ou handler que
   * lanca um erro de dominio — tudo vira { ok: false, error } e volta
   * pro loop, nunca uma excecao que derruba o job (secao 9 da SPEC.md).
   */
  private async executeTool(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { ok: false, error: `Ferramenta '${call.name}' nao existe.` };
    }

    const parsed = tool.schema.safeParse(call.arguments);
    if (!parsed.success) {
      return { ok: false, error: `Argumentos invalidos para '${call.name}': ${parsed.error.message}` };
    }

    try {
      const data = await tool.handler(parsed.data, ctx);
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: toFriendlyMessage(error) };
    }
  }
}

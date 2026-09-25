import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../shared/config/env.schema';
import type {
  LlmCompletionInput,
  LlmCompletionResult,
  LlmMessage,
  LlmPort,
  ToolCall,
} from '../ports/llm.port';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Achado no teste manual da Fase 3: 503 "high demand" e comportamento
// normal do free tier, nao excecao rara — precisa de retry de verdade, nao
// so tratamento de erro. 429 (rate limit) e os outros 5xx tem a mesma
// causa raiz (o servidor, nao o request, nao esta pronto agora).
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

// "algo como 1s / 3s / 8s" — pedido explicito, mantido literal em vez de
// uma formula generica pra ficar facil de conferir contra o pedido.
const RETRY_DELAYS_MS = [1000, 3000, 8000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Jitter de +-30% pra evitar que varios turnos que falharam juntos
// (ex.: uma janela ruim do Gemini afetando varias conversas ao mesmo
// tempo) re-tentem todos no mesmo instante.
function withJitter(delayMs: number): number {
  const jitter = delayMs * 0.3 * (Math.random() * 2 - 1);
  return Math.round(delayMs + jitter);
}

class RetryableGeminiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: unknown };
  functionResponse?: { name: string; response: unknown };
  /**
   * Exigido pela API em respostas com functionCall nesta geracao de
   * modelo — precisa ser devolvido intacto quando essa functionCall e
   * re-enviada no historico da proxima iteracao do loop, senao:
   * "Function call is missing a thought_signature in functionCall parts"
   * (validado na mao na Fase 3).
   */
  thoughtSignature?: string;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  error?: { message?: string };
}

function toGeminiContent(message: LlmMessage): GeminiContent {
  if (message.role === 'tool') {
    let response: unknown;
    try {
      response = JSON.parse(message.content);
    } catch {
      response = { raw: message.content };
    }
    // A API rejeita role "function" nesta geracao de modelo ("Role
    // 'function' is not supported" — validado na mao na Fase 3). A lista
    // de roles validos devolvida pela propria API nao tem nada equivalente
    // a function/tool — "user" e o padrao mais antigo da API pra devolver
    // resultado de function call, entao voltamos pra ele.
    return {
      role: 'user',
      parts: [{ functionResponse: { name: message.toolName ?? 'unknown', response } }],
    };
  }

  if (message.role === 'assistant') {
    if (message.toolCalls?.length) {
      return {
        role: 'model',
        parts: message.toolCalls.map((call) => ({
          functionCall: { name: call.name, args: call.arguments },
          // Devolve o thought signature que a propria API mandou — ver
          // comentario em GeminiPart.thoughtSignature.
          ...(typeof call.providerMetadata === 'string'
            ? { thoughtSignature: call.providerMetadata }
            : {}),
        })),
      };
    }
    return { role: 'model', parts: [{ text: message.content }] };
  }

  // role === 'user' (role === 'system' e filtrado antes de chegar aqui)
  return { role: 'user', parts: [{ text: message.content }] };
}

/**
 * Implementa LlmPort via fetch nativo contra a API REST do Gemini
 * (generateContent com function calling) — mesmo padrao do
 * WhatsappCloudAdapter da Fase 1, sem SDK novo.
 *
 * Testado na mao contra a API real na Fase 3 (GEMINI_API_KEY real). Dois
 * problemas de schema foram achados e corrigidos nesse teste, e nenhum dos
 * dois reapareceu depois do fix:
 * - role "function" pra resposta de tool nao e mais aceito — usa "user".
 * - functionCall precisa devolver o thoughtSignature intacto na proxima
 *   iteracao do loop (ver GeminiPart.thoughtSignature / ToolCall.providerMetadata).
 *
 * O teste manual tambem expos 503 "high demand" persistente — nao um bug
 * do adapter, mas o comportamento normal do free tier sob carga. Isso nao
 * e obstaculo de teste, e requisito faltante: em producao, uma janela ruim
 * do Gemini sem retry vira escalada em massa pra recepcao. Por isso:
 * - Retry com backoff+jitter (RETRY_DELAYS_MS) para 429/5xx, por modelo.
 * - LLM_MODEL aceita uma lista ordenada (separada por virgula); qualquer
 *   falha nesse modelo (404 descontinuado, ou 429/5xx apos esgotar as
 *   tentativas) cai pro proximo da lista antes de virar falha de verdade
 *   do LlmPort.
 * So depois de esgotar TODOS os modelos e que complete() lanca — e so
 * entao RunOrchestratorTurnUseCase converte isso em escalada por
 * llm_error (ver HandleDebouncedMessageUseCase: esse motivo especifico
 * NAO marca as mensagens como consumidas, pra sobreviver a um retry).
 */
@Injectable()
export class GeminiLlmAdapter implements LlmPort {
  private readonly logger = new Logger(GeminiLlmAdapter.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async complete(input: LlmCompletionInput): Promise<LlmCompletionResult> {
    const apiKey = this.config.get('GEMINI_API_KEY', { infer: true });
    const models = this.config
      .get('LLM_MODEL', { infer: true })
      .split(',')
      .map((model) => model.trim())
      .filter((model) => model.length > 0);

    const systemMessage = input.messages.find((message) => message.role === 'system');
    const contents = input.messages.filter((message) => message.role !== 'system').map(toGeminiContent);

    const body = {
      ...(systemMessage ? { systemInstruction: { parts: [{ text: systemMessage.content }] } } : {}),
      contents,
      ...(input.tools.length > 0 ? { tools: [{ functionDeclarations: input.tools }] } : {}),
    };

    let lastError: Error = new Error('gemini_request_failed: nenhum modelo configurado em LLM_MODEL');

    for (const model of models) {
      try {
        const payload = await this.callModelWithRetry(model, apiKey, body);
        return this.toCompletionResult(payload);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(`Modelo '${model}' indisponivel (${lastError.message}) — tentando proximo da lista, se houver.`);
      }
    }

    throw lastError;
  }

  /** Ate 3 tentativas com backoff+jitter para 429/5xx neste modelo; qualquer outro erro (404, etc.) lanca na hora — o chamador (complete()) e quem decide cair pro proximo modelo da lista. */
  private async callModelWithRetry(
    model: string,
    apiKey: string,
    body: unknown,
  ): Promise<GeminiGenerateContentResponse> {
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
      const response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = (await response.json()) as GeminiGenerateContentResponse;

      if (response.ok) {
        return payload;
      }

      const reason = payload.error?.message ?? `HTTP ${response.status}`;

      if (!RETRYABLE_STATUS_CODES.has(response.status)) {
        // 404 (modelo descontinuado/indisponivel pra esta conta) e outros
        // 4xx nao se beneficiam de retry no mesmo modelo — sobe na hora.
        // complete() trata isso igual a um retry esgotado: cai pro
        // proximo modelo da lista, so lanca de vez se todos falharem.
        this.logger.error(`Falha ao chamar a API do Gemini (modelo ${model}): ${reason}`);
        throw new Error(`gemini_request_failed: ${reason}`);
      }

      const isLastAttempt = attempt === RETRY_DELAYS_MS.length - 1;
      if (isLastAttempt) {
        throw new RetryableGeminiError(`gemini_request_failed: ${reason}`, response.status);
      }

      const delay = withJitter(RETRY_DELAYS_MS[attempt]);
      this.logger.warn(
        `Gemini respondeu ${response.status} pro modelo ${model} (tentativa ${attempt + 1}/${RETRY_DELAYS_MS.length}): ${reason}. Nova tentativa em ${delay}ms.`,
      );
      await sleep(delay);
    }

    // Inalcancavel (o loop sempre retorna ou lanca), mas o TS exige um retorno.
    throw new Error('gemini_request_failed: retry loop encerrou sem resposta');
  }

  private toCompletionResult(payload: GeminiGenerateContentResponse): LlmCompletionResult {
    const parts = payload.candidates?.[0]?.content?.parts ?? [];

    const toolCalls: ToolCall[] = parts
      .filter((part) => part.functionCall !== undefined)
      .map((part, index) => ({
        id: String(index),
        name: part.functionCall!.name,
        arguments: part.functionCall!.args,
        providerMetadata: part.thoughtSignature,
      }));

    const text = parts.find((part) => typeof part.text === 'string')?.text;

    return { text, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
  }
}

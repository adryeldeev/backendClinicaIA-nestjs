export type LlmMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmMessage {
  role: LlmMessageRole;
  content: string;
  /** Presentes quando role === 'tool': a qual chamada essa mensagem responde. */
  toolCallId?: string;
  toolName?: string;
  /** Presente quando role === 'assistant' e essa resposta pediu tool calls. */
  toolCalls?: ToolCall[];
}

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema dos parametros, no formato que a API do LLM espera. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
  /**
   * Metadado opaco especifico do Gemini (thought signature) — precisa ser
   * devolvido intacto na mesma functionCall quando o historico dessa
   * chamada e re-enviado numa iteracao seguinte do loop, senao a API
   * rejeita a requisicao. Outros providers ignoram este campo.
   */
  providerMetadata?: unknown;
}

export interface LlmCompletionResult {
  text?: string;
  toolCalls?: ToolCall[];
}

export interface LlmCompletionInput {
  messages: LlmMessage[];
  tools: ToolSchema[];
}

export const LLM_PORT = Symbol('LLM_PORT');

/**
 * AD-01/AD-02: o orquestrador fala só com esta interface, nunca com o
 * Gemini diretamente. GeminiLlmAdapter implementa em producao;
 * ScriptedLlmPort (testes) implementa com respostas encenadas.
 */
export interface LlmPort {
  complete(input: LlmCompletionInput): Promise<LlmCompletionResult>;
}

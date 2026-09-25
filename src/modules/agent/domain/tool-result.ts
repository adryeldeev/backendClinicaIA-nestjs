/**
 * Contrato de retorno de toda tool (secao 9 da SPEC.md): erro de tool
 * nunca sobe como excecao para o LLM, sempre vira { ok: false, error }.
 */
export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

/** conversationId/patientId sempre vem do contexto do servidor (RN-14), nunca do LLM. */
export interface ToolContext {
  conversationId: string;
  patientId: string;
}

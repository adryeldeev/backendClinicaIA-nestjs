// RN-21: dado de saude e dado sensivel (LGPD art. 11) — log de aplicacao
// nunca deve carregar telefone nem conteudo clinico cru. Achado concreto
// (nao hipotetico) na Fase 5: HandleDebouncedMessageUseCase logava
// result.summary inteiro na escalada, que embute a mensagem crua do
// paciente quando o motivo e RN-01/RN-02 (checkInputGuardrail monta assim
// de proposito, pro HandoffTicket ficar legivel pra um humano).

const PHONE_PATTERN = /\+?\d{10,15}/g;
const MAX_LOG_LENGTH = 80;

/**
 * Mascara padroes de telefone e trunca o restante — o log fica util pra
 * saber QUE ALGO aconteceu (motivo, tamanho aproximado) sem carregar o
 * conteudo clinico/PII em si. Nao e criptografia nem reversivel de
 * proposito: e pra nao existir no log, nao pra existir ofuscado.
 */
export function redactForLog(text: string): string {
  const withoutPhones = text.replace(PHONE_PATTERN, '[telefone redigido]');
  if (withoutPhones.length <= MAX_LOG_LENGTH) {
    return withoutPhones;
  }
  return `${withoutPhones.slice(0, MAX_LOG_LENGTH)}... [${withoutPhones.length} chars, restante redigido]`;
}

export type GuardrailVerdict =
  | { triggered: false }
  | { triggered: true; reason: 'RN-01' | 'RN-02'; summary: string };

// RN-02: sinais de urgencia — checados ANTES de RN-01 de proposito: se as
// duas baterem, urgencia manda (procurar pronto-socorro/192 e mais grave
// que "nao posso dar orientacao clinica").
const URGENCY_PATTERNS: RegExp[] = [
  // "dor forte", "dor muito forte", "dor bem intensa" etc. — ate 2 palavras
  // soltas entre "dor" e o adjetivo, nao so adjacente.
  /dor(?:\s+\w+){0,2}\s+(forte|intensa|insuportavel|s[uú]bita|aguda)/iu,
  /sangrament/iu,
  /febre\s+alta/iu,
  /falta\s+de\s+ar/iu,
  /desmai/iu,
  /perda\s+de\s+consci[eê]ncia/iu,
  /fratura/iu,
  /trauma/iu,
  /engasg/iu,
  /convuls/iu,
];

// RN-01: pedido de diagnostico/orientacao clinica/medicamento.
const MEDICAL_ADVICE_PATTERNS: RegExp[] = [
  /qual\s+rem[eé]dio/iu,
  /que\s+rem[eé]dio/iu,
  /posso\s+tomar/iu,
  /dosagem/iu,
  /diagn[oó]stico/iu,
  /o\s+que\s+eu\s+tenho/iu,
  /isso\s+[eé]\s+grave/iu,
  /[eé]\s+normal\s+(sentir|ter|estar)/iu,
];

/**
 * Guardrail de ENTRADA (secao 13 da SPEC.md), antecipado da Fase 5 pra
 * Fase 3 — ver decisao registrada em SPEC.md secao 15. Roda ANTES de
 * qualquer chamada ao LLM: classificador barato por regex, nao IA.
 */
export function checkInputGuardrail(newMessages: string[]): GuardrailVerdict {
  const combined = newMessages.join(' \n ');

  for (const pattern of URGENCY_PATTERNS) {
    if (pattern.test(combined)) {
      return {
        triggered: true,
        reason: 'RN-02',
        summary: `Sinal de urgencia detectado na mensagem do paciente: "${combined}"`,
      };
    }
  }

  for (const pattern of MEDICAL_ADVICE_PATTERNS) {
    if (pattern.test(combined)) {
      return {
        triggered: true,
        reason: 'RN-01',
        summary: `Pedido de orientacao clinica detectado na mensagem do paciente: "${combined}"`,
      };
    }
  }

  return { triggered: false };
}

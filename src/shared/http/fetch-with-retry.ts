// Achado na Fase 3 (GeminiLlmAdapter): 503/429 sao comportamento normal do
// free tier do Gemini sob carga, nao excecao rara — API externa qualquer
// que retorne 429/5xx merece o mesmo tratamento. Extraido aqui pra ser
// reaproveitado por qualquer adapter HTTP que fale com o Gemini (LLM,
// embedding), sem duplicar a logica de retry.
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

// "algo como 1s / 3s / 8s" (pedido explicito na Fase 3) — mantido literal.
const RETRY_DELAYS_MS = [1000, 3000, 8000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Jitter de +-30% pra nao sincronizar retries de varias chamadas que
// falharam juntas (ex.: uma janela ruim do provedor afetando varias
// conversas ao mesmo tempo).
function withJitter(delayMs: number): number {
  const jitter = delayMs * 0.3 * (Math.random() * 2 - 1);
  return Math.round(delayMs + jitter);
}

/**
 * Ate 3 tentativas com backoff+jitter para 429/5xx. Devolve o Response
 * assim que `response.ok`, OU o Response da ULTIMA tentativa se todas
 * falharem com status retryable (o chamador decide como interpretar o
 * corpo/erro final). Para status nao-retryable (4xx que nao seja 429),
 * devolve na primeira tentativa sem re-tentar — nao adianta bater de novo
 * num erro de request malformado.
 */
export async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    const response = await fetch(url, init);

    if (response.ok || !RETRYABLE_STATUS_CODES.has(response.status)) {
      return response;
    }

    const isLastAttempt = attempt === RETRY_DELAYS_MS.length - 1;
    if (isLastAttempt) {
      return response;
    }

    await sleep(withJitter(RETRY_DELAYS_MS[attempt]));
  }

  // Inalcancavel (o loop sempre retorna), mas o TS exige um retorno.
  throw new Error('fetchWithRetry: loop encerrou sem resposta');
}

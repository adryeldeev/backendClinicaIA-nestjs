export const EMBEDDING_PORT = Symbol('EMBEDDING_PORT');

/**
 * AD-01/AD-02 (mesmo espirito do LlmPort): o modulo knowledge so fala com
 * esta interface, nunca com o Gemini diretamente. GeminiEmbeddingAdapter
 * implementa em producao; FakeEmbeddingPort (testes) devolve vetores
 * controlados pelo teste, sem rede.
 */
export interface EmbeddingPort {
  embed(text: string): Promise<number[]>;
}

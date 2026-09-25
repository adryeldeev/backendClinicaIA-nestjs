export interface WaitForOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

/**
 * Faz polling ate `check` retornar um valor truthy, ou estoura timeout.
 * Usado para aguardar o pipeline assincrono (debounce + fila) nos testes e2e.
 */
export async function waitFor<T>(check: () => Promise<T | null | undefined>, options: WaitForOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const intervalMs = options.intervalMs ?? 100;
  const startedAt = Date.now();

  for (;;) {
    const result = await check();
    if (result) {
      return result;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`waitFor: timeout de ${timeoutMs}ms esperando a condicao ficar verdadeira.`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

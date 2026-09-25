/**
 * Gera um numero de telefone unico por chamada, para que os testes e2e
 * possam ser reexecutados sem colidir com dados de uma execucao anterior
 * (o Postgres de desenvolvimento nao e resetado entre execucoes de teste).
 */
export function uniquePhone(): string {
  const random = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0');
  return `5585${Date.now()}${random}`;
}

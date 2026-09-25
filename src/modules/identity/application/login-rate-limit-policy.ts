const RATE_LIMIT_PATTERN = /^(\d+)\/(\d+)([smh])$/;

/**
 * Compartilhado entre LoginRateLimitGuard (le, nunca incrementa) e
 * LoginUseCase (unico lugar que incrementa — so sabe o desfecho real do
 * login). Extraido pra um so lugar depois do achado do usuario: o guard
 * sozinho nao pode saber se a tentativa foi bem-sucedida, entao nao pode
 * ser o unico dono do contador.
 */
export function parseWindowSeconds(raw: string): { limit: number; windowSeconds: number } {
  const match = RATE_LIMIT_PATTERN.exec(raw);
  if (!match) {
    throw new Error(`LOGIN_RATE_LIMIT invalido: "${raw}" (esperado ex.: "5/15m")`);
  }
  const [, limitRaw, amountRaw, unit] = match;
  const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : 3600;
  return { limit: Number(limitRaw), windowSeconds: Number(amountRaw) * multiplier };
}

/**
 * Chave inclui e-mail, nao so IP (achado do usuario apos o incidente de
 * 2026-09-23: o front testando local esgotava a janela inteira do IP em
 * poucos minutos so alternando entre logins bem-sucedidos e testes de
 * papel/sessao — nenhum deles era forca bruta). E-mail normalizado
 * (lowercase+trim) pra nao abrir bypass trivial por capitalizacao.
 */
export function loginRateLimitKey(ip: string, email: string): string {
  const normalizedEmail = email.toLowerCase().trim();
  return `login-rate-limit:${ip}:${normalizedEmail}`;
}

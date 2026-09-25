import { sign } from 'cookie-signature';

/**
 * Reproduz o formato que o cookie-parser espera em req.signedCookies:
 * "s:<valor>.<hmac>" — sem isso, testar SessionGuard contra um cookie
 * assinado manualmente (sem passar pelo endpoint de login) e impossivel.
 */
export function signCookieValue(rawValue: string, secret: string): string {
  return `s:${sign(rawValue, secret)}`;
}

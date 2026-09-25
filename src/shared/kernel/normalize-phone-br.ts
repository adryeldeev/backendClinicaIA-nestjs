/**
 * Achado do usuario (2026-09-25): telefone digitado pela recepcao no
 * cadastro manual de paciente e normalizado pro formato E.164 aqui, no
 * servidor — nunca depende da tela mandar ja formatado. So Brasil (mesmo
 * escopo do resto do projeto — CLINIC_TIMEZONE fixo em America/Fortaleza,
 * nunca multi-pais): DDD de 2 digitos + numero local de 8 (fixo) ou 9
 * (celular) digitos.
 *
 * Aceita com ou sem o codigo do pais (55) ja digitado, com qualquer
 * pontuacao/espaco (o usuario pode digitar "(85) 99999-9999",
 * "85999999999" ou "+5585999999999" — os tres normalizam pro mesmo
 * resultado). `null` quando a contagem de digitos nao bate com nenhum
 * formato valido — o chamador decide como reportar (nunca aceita
 * silenciosamente um numero que nao e telefone de verdade).
 */
export function normalizePhoneToE164Br(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');

  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    return `+${digits}`;
  }
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }
  return null;
}

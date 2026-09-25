import { z, ZodIssueCode, defaultErrorMap } from 'zod';

function fieldLabel(path: (string | number)[]): string {
  return path.length > 0 ? `"${path.join('.')}"` : 'o valor enviado';
}

/**
 * Achado do front (regressao real, 2026-09-24): mensagem de erro de
 * validacao vira texto exibido pra recepcionista (o front mostra `message`
 * da API como esta, sem traduzir) — "Expected number, received nan" nao e
 * aceitavel. `z.setErrorMap` e o mecanismo CERTO do Zod pra isso (nao pos-
 * processar em parseDto): Zod so consulta o error map quando o proprio
 * schema NAO deu uma mensagem customizada (ex.: `.max(100, 'texto proprio')`
 * continua usando o texto proprio, intacto) — resolve os genericos sem
 * atropelar quem ja escreveu mensagem especifica.
 */
export const portugueseZodErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === 'undefined') {
        return { message: `Campo obrigatório: ${fieldLabel(issue.path)}.` };
      }
      return { message: `Valor inválido para ${fieldLabel(issue.path)} (esperado ${issue.expected}).` };
    case ZodIssueCode.too_small:
      return { message: `${fieldLabel(issue.path)} deve ter no mínimo ${issue.minimum}.` };
    case ZodIssueCode.too_big:
      return { message: `${fieldLabel(issue.path)} não pode passar de ${issue.maximum}.` };
    case ZodIssueCode.invalid_enum_value:
      return {
        message: `Valor inválido para ${fieldLabel(issue.path)}: use um de [${issue.options.join(', ')}].`,
      };
    case ZodIssueCode.invalid_string:
      return { message: `${fieldLabel(issue.path)} tem formato inválido.` };
    case ZodIssueCode.invalid_date:
      return { message: `${fieldLabel(issue.path)} não é uma data válida.` };
    default:
      return defaultErrorMap(issue, ctx);
  }
};

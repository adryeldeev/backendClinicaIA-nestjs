import { BadRequestException } from '@nestjs/common';
import type { ZodType, z } from 'zod';

/**
 * Mesmo padrao de validacao ja usado nas tools do agente (schema.safeParse),
 * agora pro corpo/query dos controllers admin — sem depender de
 * class-validator, projeto inteiro ja usa Zod. ZodError vira 400 com
 * mensagem legivel, no formato uniforme via HttpExceptionFilter.
 *
 * Mensagem em portugues: `z.setErrorMap()` (configureApp, chamado por
 * main.ts E pelos testes) traduz os codigos de issue genericos do Zod ANTES
 * de chegar aqui — achado do front (regressao real, 2026-09-24): a
 * mensagem de erro vira texto exibido pra recepcionista, e "Expected
 * number, received nan" nao e aceitavel. Ver shared/http/zod-error-map.ts.
 *
 * Achado do usuario (2026-09-25): quando o cliente manda uma requisicao
 * SEM `Content-Type: application/json` (nao so corpo vazio — corpo
 * AUSENTE), o body-parser do Express nunca roda, e `@Body()` chega aqui
 * como `undefined`, nao `{}`. Pra um schema onde TODO campo e opcional
 * (ex.: `{motivo?}` do cancelamento), isso rejeitava na raiz com "campo
 * obrigatorio: o valor enviado" mesmo sem nenhum campo obrigatorio de
 * verdade — 400 espurio que impedia a acao. Corpo opcional tem que ser
 * opcional de verdade: `undefined` na raiz vira `{}` antes do parse, pra
 * um schema so de campos opcionais aceitar tanto "sem corpo" quanto
 * "corpo vazio" da mesma forma. Correcao aqui (generica, todo controller
 * que usa parseDto), nao no controller de cancelamento especifico — e o
 * parser que estava errado, nao a tela.
 */
export function parseDto<T extends ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input === undefined ? {} : input);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map((issue) => issue.message).join('; '));
  }
  return result.data;
}

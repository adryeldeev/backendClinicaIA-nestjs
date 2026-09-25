import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { z } from 'zod';
import type { Env } from '../config/env.schema';
import { AllExceptionsFilter, DomainExceptionFilter, HttpExceptionFilter } from './domain-exception.filter';
import { securityHeadersMiddleware } from './security-headers.middleware';
import { portugueseZodErrorMap } from './zod-error-map';

/**
 * Setup compartilhado entre main.ts (producao) e os testes e2e que
 * constroem o app via TestingModule diretamente (que NAO passa por
 * main.ts) — sem isso, cookie assinado/CORS/filtro de erro uniforme so
 * existiriam em producao e nunca seriam exercitados por teste nenhum.
 */
export function configureApp(app: INestApplication, config: ConfigService<Env, true>): void {
  z.setErrorMap(portugueseZodErrorMap);
  app.use(cookieParser(config.get('SESSION_SECRET', { infer: true })));
  app.use('/api/admin', securityHeadersMiddleware);
  app.enableCors({ origin: config.get('ADMIN_ORIGIN', { infer: true }), credentials: true });
  // Ordem importa e e a INVERSA do que pareceria intuitivo (confirmado na
  // pratica, nao suposto): Nest resolve o ULTIMO filtro cuja assinatura
  // @Catch bate primeiro, entao o catch-all (@Catch() sem argumento, casa
  // com tudo) precisa vir PRIMEIRO na lista pra nao "vencer" os
  // especificos — testado invertido e SessionExpiredError (DomainError de
  // verdade) estava caindo no AllExceptionsFilter em vez do
  // DomainExceptionFilter.
  app.useGlobalFilters(new AllExceptionsFilter(), new HttpExceptionFilter(), new DomainExceptionFilter());
}

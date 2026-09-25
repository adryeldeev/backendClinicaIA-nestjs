import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../src/shared/config/env.schema';
import { configureApp } from '../../src/shared/http/configure-app';

/**
 * Mesmo setup do main.ts (cookie assinado, CORS, filtro de erro uniforme) —
 * TestingModule.createNestApplication() nao passa por main.ts, entao sem
 * isso nenhum teste e2e exerceria esse comportamento de verdade.
 */
export function configureTestApp(app: INestApplication): void {
  const config = app.get(ConfigService<Env, true>);
  configureApp(app, config);
}

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import type { Env } from './shared/config/env.schema';
import { configureApp } from './shared/http/configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService<Env, true>);

  configureApp(app, config);

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
}

bootstrap().catch((error) => {
  // Achado real do primeiro lint do projeto (2026-09-23): sem isso, falha
  // no boot (ex.: banco fora do ar, env invalida) virava unhandled
  // rejection em vez de erro claro com exit code diferente de zero.
  console.error('Falha ao iniciar a aplicacao:', error);
  process.exitCode = 1;
});

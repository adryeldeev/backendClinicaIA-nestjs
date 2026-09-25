import 'reflect-metadata';
import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { clearLoginRateLimit } from '../support/clear-login-rate-limit';
import { configureTestApp } from '../support/configure-test-app';
import { uniquePhone } from '../support/unique-phone';
import { waitForQueueWorkersReady } from '../support/wait-for-queues-ready';

/**
 * SEC-08 / criterio de aceite #16: 5 tentativas / 15 min / IP+e-mail
 * (LOGIN_RATE_LIMIT=5/15m no .env de teste). supertest sem X-Forwarded-For
 * cai tudo no mesmo IP de loopback, exatamente o cenario que queremos
 * testar.
 *
 * Achado do usuario apos o incidente de 2026-09-23: o contador so pode
 * subir em falha de verdade — login certo nao conta (o front local tinha
 * esgotado a janela inteira so alternando entre login bem-sucedido e testes
 * de sessao/papel, nenhum deles forca bruta).
 */
describe('Rate limit de login (e2e) — SEC-08 / criterio de aceite #16', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureTestApp(app);
    prisma = moduleRef.get(PrismaService);
    await app.init();
    await waitForQueueWorkersReady(moduleRef);
    await clearLoginRateLimit(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  it('6a tentativa de login em 15 minutos e bloqueada com 429, mesmo com senha certa', async () => {
    const email = `rate-limit-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Teste Rate Limit', role: 'ADMIN' },
    });

    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await request(app.getHttpServer())
        .post('/api/admin/auth/login')
        .send({ email, password: 'senha-errada-de-proposito' });
      expect(response.status).toBe(401);
    }

    const sixthAttempt = await request(app.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ email, password });

    expect(sixthAttempt.status).toBe(429);
    expect(sixthAttempt.body.error.code).toBe('LOGIN_RATE_LIMITED');
  });

  it('login bem-sucedido repetido nao conta contra o limite (regressao: guard antigo incrementava em qualquer tentativa)', async () => {
    const email = `rate-limit-success-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Teste Rate Limit Sucesso', role: 'ADMIN' },
    });

    for (let attempt = 1; attempt <= 6; attempt++) {
      const response = await request(app.getHttpServer())
        .post('/api/admin/auth/login')
        .send({ email, password });
      expect(response.status).toBe(HttpStatus.NO_CONTENT);
    }
  });

  it('chave inclui o e-mail: esgotar o limite pra um e-mail nao bloqueia outro no mesmo IP', async () => {
    const blockedEmail = `rate-limit-blocked-${uniquePhone()}@clinica.test`;
    const otherEmail = `rate-limit-other-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email: otherEmail, passwordHash: await argon2.hash(password), name: 'Outro Usuario', role: 'ADMIN' },
    });

    for (let attempt = 1; attempt <= 5; attempt++) {
      await request(app.getHttpServer())
        .post('/api/admin/auth/login')
        .send({ email: blockedEmail, password: 'senha-errada-de-proposito' });
    }

    const otherEmailAttempt = await request(app.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ email: otherEmail, password });

    expect(otherEmailAttempt.status).toBe(HttpStatus.NO_CONTENT);
  });
});

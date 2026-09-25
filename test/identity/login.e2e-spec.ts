import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
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

describe('POST/GET /api/admin/auth (login, me, logout) (e2e)', () => {
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

  async function createUser(overrides: { active?: boolean } = {}): Promise<{ email: string; password: string }> {
    const email = `admin-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(password),
        name: 'Admin Teste',
        role: 'ADMIN',
        active: overrides.active ?? true,
      },
    });
    return { email, password };
  }

  it('login com credenciais corretas seta cookie httpOnly, e /me devolve o usuario', async () => {
    const { email, password } = await createUser();

    const loginResponse = await request(app.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ email, password });

    expect(loginResponse.status).toBe(204);
    const setCookie = loginResponse.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookieHeader).toContain('HttpOnly');

    const meResponse = await request(app.getHttpServer())
      .get('/api/admin/auth/me')
      .set('Cookie', cookieHeader);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body).toMatchObject({ email, role: 'ADMIN' });
    // Achado do usuario (2026-09-25): pendente desde o primeiro dia, e a
    // agenda depende dele pra renderizar horario — sem isso o front nao
    // sabe se um startsAt UTC e "hoje 9h" ou "ontem 21h" na clinica.
    expect(meResponse.body.timezone).toBe('America/Fortaleza');
  });

  it('login com senha errada retorna 401 no formato uniforme de erro', async () => {
    const { email } = await createUser();

    const response = await request(app.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ email, password: 'senha-errada' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { code: 'INVALID_CREDENTIALS', message: expect.any(String) },
    });
  });

  it('login de usuario inativo retorna 401 (mesma mensagem generica de credenciais invalidas)', async () => {
    const { email, password } = await createUser({ active: false });

    const response = await request(app.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ email, password });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('criterio de aceite #13: GET /me sem cookie de sessao valido retorna 401', async () => {
    const response = await request(app.getHttpServer()).get('/api/admin/auth/me');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: { code: 'SESSION_EXPIRED', message: expect.any(String) },
    });
  });

  it('logout revoga a sessao — cookie usado depois vira 401', async () => {
    const { email, password } = await createUser();
    const loginResponse = await request(app.getHttpServer())
      .post('/api/admin/auth/login')
      .send({ email, password });
    const cookieHeader = loginResponse.headers['set-cookie'][0];

    const logoutResponse = await request(app.getHttpServer())
      .post('/api/admin/auth/logout')
      .set('Cookie', cookieHeader);
    expect(logoutResponse.status).toBe(204);

    const meAfterLogout = await request(app.getHttpServer())
      .get('/api/admin/auth/me')
      .set('Cookie', cookieHeader);
    expect(meAfterLogout.status).toBe(401);
  });
});

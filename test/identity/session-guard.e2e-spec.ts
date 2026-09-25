import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { hashSessionToken } from '../../src/modules/identity/application/login.use-case';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { clearLoginRateLimit } from '../support/clear-login-rate-limit';
import { configureTestApp } from '../support/configure-test-app';
import { signCookieValue } from '../support/sign-cookie';
import { uniquePhone } from '../support/unique-phone';
import { waitForQueueWorkersReady } from '../support/wait-for-queues-ready';

describe('SessionGuard — sessao expirada/revogada/adulterada (e2e)', () => {
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

  async function createUserWithSession(session: { expiresAt: Date; revokedAt?: Date }): Promise<string> {
    const email = `session-${uniquePhone()}@clinica.test`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await argon2.hash('senha-forte-123'), name: 'Teste Sessao', role: 'ADMIN' },
    });
    const rawToken = `raw-token-${uniquePhone()}`;
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(rawToken),
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt,
      },
    });
    return rawToken;
  }

  it('sessao expirada (expiresAt no passado) retorna 401 mesmo com cookie assinado valido', async () => {
    const rawToken = await createUserWithSession({ expiresAt: new Date(Date.now() - 1000) });
    const signedValue = signCookieValue(rawToken, process.env.SESSION_SECRET as string);

    const response = await request(app.getHttpServer())
      .get('/api/admin/auth/me')
      .set('Cookie', `clinica_session=${encodeURIComponent(signedValue)}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('sessao revogada (logout previo) retorna 401 mesmo com cookie assinado valido', async () => {
    const rawToken = await createUserWithSession({
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      revokedAt: new Date(),
    });
    const signedValue = signCookieValue(rawToken, process.env.SESSION_SECRET as string);

    const response = await request(app.getHttpServer())
      .get('/api/admin/auth/me')
      .set('Cookie', `clinica_session=${encodeURIComponent(signedValue)}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('cookie de sessao adulterado (assinatura invalida) retorna 401, nao 500', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/admin/auth/me')
      .set('Cookie', 'clinica_session=valor-forjado-sem-assinatura-valida');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('SESSION_EXPIRED');
  });

  /**
   * O guard revalida o usuario a CADA requisicao (join fresco com User, nao
   * confia no que foi lido no login) — mas so isso nao basta se ninguem
   * checar `active` explicitamente. Prova de ponta a ponta: login de
   * verdade, sessao continua tecnicamente valida (nao expirou, nao foi
   * revogada) mas o usuario e desativado no meio do caminho — a MESMA
   * sessao tem que parar de funcionar na proxima requisicao, sem esperar
   * as ate 12h de SESSION_TTL_HOURS.
   */
  it('usuario desativado no meio da sessao ativa perde acesso na proxima requisicao (nao espera a sessao expirar)', async () => {
    const email = `desativado-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Sera Desativado', role: 'ADMIN', active: true },
    });

    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    const cookie = loginResponse.headers['set-cookie'][0];

    const meBeforeDeactivation = await request(app.getHttpServer()).get('/api/admin/auth/me').set('Cookie', cookie);
    expect(meBeforeDeactivation.status).toBe(200);

    await prisma.user.update({ where: { email }, data: { active: false } });

    const meAfterDeactivation = await request(app.getHttpServer()).get('/api/admin/auth/me').set('Cookie', cookie);
    expect(meAfterDeactivation.status).toBe(401);
    expect(meAfterDeactivation.body.error.code).toBe('SESSION_EXPIRED');
  });

  /**
   * Metade "positiva" da mesma pergunta: troca de papel no meio da sessao
   * ativa (rebaixamento de ADMIN pra RECEPCAO, por exemplo) ja vale na
   * proxima requisicao — nao precisa de logout/login pra "atualizar" o
   * papel, porque o guard nunca cacheou o papel do login pra comecar.
   */
  it('troca de papel no meio da sessao ativa vale na proxima requisicao, sem novo login', async () => {
    const email = `rebaixado-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Sera Rebaixado', role: 'ADMIN' },
    });

    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    const cookie = loginResponse.headers['set-cookie'][0];

    const meBefore = await request(app.getHttpServer()).get('/api/admin/auth/me').set('Cookie', cookie);
    expect(meBefore.body.role).toBe('ADMIN');

    await prisma.user.update({ where: { email }, data: { role: 'RECEPCAO' } });

    const meAfter = await request(app.getHttpServer()).get('/api/admin/auth/me').set('Cookie', cookie);
    expect(meAfter.status).toBe(200);
    expect(meAfter.body.role).toBe('RECEPCAO');
  });
});

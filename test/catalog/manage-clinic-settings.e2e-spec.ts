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

/**
 * RN-25: GET/PUT /api/admin/settings/ai-enabled.
 *
 * CUIDADO DE ISOLAMENTO (achado real, nao hipotetico): ManageClinicSettingsUseCase
 * opera sobre "a clinica primaria" (a mais antiga por createdAt) de TODAS
 * as Clinic ja criadas no banco compartilhado de teste (nunca resetado).
 * A primeira tentativa deste arquivo tentava fabricar uma clinica
 * "artificialmente antiga" pra virar a primaria durante o teste — nao
 * funciona de forma confiavel, porque o tempo real so anda pra frente:
 * uma execucao anterior desta mesma suite (ou de uma sessao de debug)
 * sempre tem uma data "antiga" ainda mais antiga que qualquer tentativa
 * nova. Por isso este arquivo NUNCA cria sua propria clinica — sempre le
 * o valor ATUAL via GET, guarda, testa, e restaura via PUT no fim,
 * usando `try/finally` pra restaurar mesmo se uma asserção no meio falhar.
 */
describe('SettingsAdminController — RN-25 (interruptor global de IA) (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureTestApp(app);
    prisma = moduleRef.get(PrismaService);
    await app.init();
    await waitForQueueWorkersReady(moduleRef);
    await clearLoginRateLimit(moduleRef);

    const email = `admin-settings-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Admin Settings', role: 'ADMIN' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    adminCookie = loginResponse.headers['set-cookie'][0];
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET devolve um boolean (formato correto), PUT muda o valor e GET reflete — sempre restaurando o original', async () => {
    const before = await request(app.getHttpServer()).get('/api/admin/settings/ai-enabled').set('Cookie', adminCookie);
    expect(before.status).toBe(200);
    expect(typeof before.body.enabled).toBe('boolean');
    const originalValue: boolean = before.body.enabled;

    try {
      const toggled = !originalValue;
      const putResponse = await request(app.getHttpServer())
        .put('/api/admin/settings/ai-enabled')
        .set('Cookie', adminCookie)
        .send({ enabled: toggled });
      expect(putResponse.status).toBe(200);
      expect(putResponse.body).toEqual({ enabled: toggled });

      const after = await request(app.getHttpServer()).get('/api/admin/settings/ai-enabled').set('Cookie', adminCookie);
      expect(after.body).toEqual({ enabled: toggled });
    } finally {
      // Restaura SEMPRE, mesmo se uma asserção acima tiver falhado — sem
      // isso, qualquer teste depois deste na suite inteira que espera o
      // bot responder passaria a falhar silenciosamente.
      await request(app.getHttpServer())
        .put('/api/admin/settings/ai-enabled')
        .set('Cookie', adminCookie)
        .send({ enabled: originalValue });
    }
  });

  it('papel RECEPCAO recebe 403 (rota restrita a ADMIN)', async () => {
    const email = `recepcao-settings-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Recepcao Settings', role: 'RECEPCAO' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    const cookie = loginResponse.headers['set-cookie'][0];

    const response = await request(app.getHttpServer())
      .put('/api/admin/settings/ai-enabled')
      .set('Cookie', cookie)
      .send({ enabled: false });

    expect(response.status).toBe(403);
  });
});

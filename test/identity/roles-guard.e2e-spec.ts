import 'reflect-metadata';
import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { CurrentUser, Roles, RolesGuard, SessionGuard } from '../../src/modules/identity';
import type { AuthenticatedUser } from '../../src/modules/identity';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { clearLoginRateLimit } from '../support/clear-login-rate-limit';
import { configureTestApp } from '../support/configure-test-app';
import { uniquePhone } from '../support/unique-phone';
import { waitForQueueWorkersReady } from '../support/wait-for-queues-ready';

/**
 * Controller so-de-teste: exercita SessionGuard+RolesGuard sem depender de
 * nenhum recurso admin real (que so existe a partir da Etapa 2). Uma rota
 * exige ADMIN, outra aceita qualquer papel autenticado (regra "sem @Roles
 * = todos" do RolesGuard).
 */
@Controller('test-only/rbac')
class RbacTestController {
  @Get('admin-only')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles('ADMIN')
  adminOnly(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  @Get('any-role')
  @UseGuards(SessionGuard, RolesGuard)
  anyRole(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}

describe('RolesGuard (e2e, controller de teste)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    // Controller de teste direto no modulo raiz (nao aninhado em um @Module
    // separado) — importando AppModule aqui ja traz IdentityModule (que
    // exporta SessionGuard/RolesGuard) pro escopo acessivel deste modulo.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [RbacTestController],
    }).compile();
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

  async function loginAs(role: 'ADMIN' | 'RECEPCAO' | 'PROFISSIONAL'): Promise<string> {
    const email = `${role.toLowerCase()}-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Teste RBAC', role, active: true },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    return loginResponse.headers['set-cookie'][0];
  }

  it('papel ADMIN acessa rota restrita a ADMIN', async () => {
    const cookie = await loginAs('ADMIN');
    const response = await request(app.getHttpServer()).get('/test-only/rbac/admin-only').set('Cookie', cookie);
    expect(response.status).toBe(200);
  });

  it('papel RECEPCAO recebe 403 na rota restrita a ADMIN', async () => {
    const cookie = await loginAs('RECEPCAO');
    const response = await request(app.getHttpServer()).get('/test-only/rbac/admin-only').set('Cookie', cookie);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('rota sem @Roles() aceita qualquer papel autenticado (PROFISSIONAL incluso)', async () => {
    const cookie = await loginAs('PROFISSIONAL');
    const response = await request(app.getHttpServer()).get('/test-only/rbac/any-role').set('Cookie', cookie);
    expect(response.status).toBe(200);
  });
});

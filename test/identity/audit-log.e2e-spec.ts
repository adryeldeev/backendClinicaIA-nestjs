import 'reflect-metadata';
import { Controller, Get, INestApplication, Param, UseGuards, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { AuditInterceptor, SessionGuard } from '../../src/modules/identity';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { clearLoginRateLimit } from '../support/clear-login-rate-limit';
import { configureTestApp } from '../support/configure-test-app';
import { uniquePhone } from '../support/unique-phone';
import { waitFor } from '../support/wait-for';
import { waitForQueueWorkersReady } from '../support/wait-for-queues-ready';

/**
 * Controller so-de-teste: uma rota generica com :id, protegida por
 * SessionGuard + AuditInterceptor — o mesmo par que qualquer controller
 * admin real (Etapas 2-5) vai usar pra ler dado de paciente.
 */
@Controller('api/admin/audited-test')
class AuditedTestController {
  @Get(':id')
  @UseGuards(SessionGuard)
  @UseInterceptors(AuditInterceptor)
  read(@Param('id') id: string): { id: string } {
    return { id };
  }
}

describe('AuditInterceptor — SEC-10 / criterio de aceite #17 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [AuditedTestController],
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

  it('leitura numa rota auditada gera AuditLog com ator, acao e entidade', async () => {
    const email = `audit-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    const user = await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Teste Audit', role: 'ADMIN' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    const cookie = loginResponse.headers['set-cookie'][0];

    const entityId = uniquePhone();
    const response = await request(app.getHttpServer())
      .get(`/api/admin/audited-test/${entityId}`)
      .set('Cookie', cookie);
    expect(response.status).toBe(200);

    // O interceptor grava de forma assincrona (tap, sem await na resposta,
    // e a escrita em si e uma query real no Postgres) — poll ate aparecer.
    const log = await waitFor(() => prisma.auditLog.findFirst({ where: { entityId } }));

    expect(log.actorType).toBe('user');
    expect(log.actorId).toBe(user.id);
    expect(log.entityType).toBe('audited-test');
    expect(log.action).toBe('get:/api/admin/audited-test/:id');
  });
});

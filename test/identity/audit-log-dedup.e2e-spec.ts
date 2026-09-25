import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { CLOCK } from '../../src/shared/kernel/clock';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { clearLoginRateLimit } from '../support/clear-login-rate-limit';
import { configureTestApp } from '../support/configure-test-app';
import { FixedClock } from '../support/fixed-clock';
import { uniquePhone } from '../support/unique-phone';
import { waitFor } from '../support/wait-for';
import { waitForQueueWorkersReady } from '../support/wait-for-queues-ready';

const SECOND_MS = 1000;
const T0 = new Date('2026-01-15T12:00:00.000Z');

/**
 * SEC-10 (achado do front, contrato da Fase 1, item F): polling de ~5s por
 * conversa aberta gerava ~11 mil linhas/dia/recepcionista sem sinal
 * nenhum. AuditService dedupe por (ator, entidade, acao) dentro de
 * AUDIT_DEDUP_WINDOW_SECONDS — este teste prova o mecanismo real, nao so
 * "o endpoint funciona".
 */
describe('AuditLog — deduplicacao por janela (SEC-10, e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let clock: FixedClock;

  beforeAll(async () => {
    clock = new FixedClock(T0);
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureTestApp(app);
    prisma = moduleRef.get(PrismaService);
    await app.init();
    await waitForQueueWorkersReady(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    clock.set(T0);
    await clearLoginRateLimit(moduleRef);
  });

  // AuditInterceptor grava de forma assincrona (tap, sem await na resposta
  // HTTP — mesmo padrao de test/identity/audit-log.e2e-spec.ts) — poll ate
  // a contagem esperada aparecer, nunca assumir que ja aconteceu so porque
  // a resposta HTTP voltou.
  async function waitForAuditCount(where: Record<string, unknown>, expected: number) {
    return waitFor(async () => {
      const count = await prisma.auditLog.count({ where });
      return count >= expected ? count : undefined;
    });
  }

  async function loginAs(label: string): Promise<{ cookie: string; userId: string }> {
    const email = `admin-audit-${label}-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    const user = await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: `Admin Audit ${label}`, role: 'ADMIN' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    return { cookie: loginResponse.headers['set-cookie'][0], userId: user.id };
  }

  it('polling repetido (mesmo ator/entidade/acao) dentro da janela gera 1 linha, nao 12', async () => {
    const admin = await loginAs('poll');
    const patient = await prisma.patient.create({ data: { phoneE164: `+${uniquePhone()}` } });
    const conversation = await prisma.conversation.create({ data: { patientId: patient.id } });

    for (let i = 0; i < 5; i++) {
      const response = await request(app.getHttpServer())
        .get(`/api/admin/conversations/${conversation.id}`)
        .set('Cookie', admin.cookie);
      expect(response.status).toBe(200);
    }

    const auditWhere = { actorId: admin.userId, entityType: 'conversations', entityId: conversation.id };
    // Espera a 1a linha aparecer (escrita assincrona), depois confirma que
    // NENHUMA das outras 4 chamadas gerou uma 2a.
    await waitForAuditCount(auditWhere, 1);
    await new Promise((resolve) => setTimeout(resolve, 200)); // margem pra uma 2a linha indevida aparecer, se houvesse bug
    expect(await prisma.auditLog.count({ where: auditWhere })).toBe(1);
  });

  it('reabrir depois da janela gera uma 2a linha (evento de acesso distinto, nao ruido)', async () => {
    const admin = await loginAs('reopen');
    const patient = await prisma.patient.create({ data: { phoneE164: `+${uniquePhone()}` } });
    const conversation = await prisma.conversation.create({ data: { patientId: patient.id } });
    const auditWhere = { actorId: admin.userId, entityType: 'conversations', entityId: conversation.id };

    await request(app.getHttpServer()).get(`/api/admin/conversations/${conversation.id}`).set('Cookie', admin.cookie);
    await waitForAuditCount(auditWhere, 1);

    // Alem de AUDIT_DEDUP_WINDOW_SECONDS (60s default do .env de teste).
    clock.set(new Date(T0.getTime() + 61 * SECOND_MS));

    await request(app.getHttpServer()).get(`/api/admin/conversations/${conversation.id}`).set('Cookie', admin.cookie);

    const count = await waitForAuditCount(auditWhere, 2);
    expect(count).toBe(2);
  });

  it('atores diferentes olhando a MESMA conversa cada um gera sua propria linha, mesmo na mesma janela', async () => {
    const adminA = await loginAs('multi-a');
    const adminB = await loginAs('multi-b');
    const patient = await prisma.patient.create({ data: { phoneE164: `+${uniquePhone()}` } });
    const conversation = await prisma.conversation.create({ data: { patientId: patient.id } });
    const entityWhere = { entityType: 'conversations', entityId: conversation.id };

    await request(app.getHttpServer()).get(`/api/admin/conversations/${conversation.id}`).set('Cookie', adminA.cookie);
    await waitForAuditCount({ ...entityWhere, actorId: adminA.userId }, 1);

    await request(app.getHttpServer()).get(`/api/admin/conversations/${conversation.id}`).set('Cookie', adminB.cookie);
    const count = await waitForAuditCount(entityWhere, 2);
    expect(count).toBe(2);
  });
});

import 'reflect-metadata';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { clearLoginRateLimit } from '../support/clear-login-rate-limit';
import { configureTestApp } from '../support/configure-test-app';
import { uniquePhone } from '../support/unique-phone';
import { waitForQueueWorkersReady } from '../support/wait-for-queues-ready';

// Achado do usuario (2026-09-24): `INestApplication.getHttpServer()` sem o
// generic e tipado `any` (nao documentado, confirmado lendo
// @nestjs/core/nest-application.d.ts) — todo `request(app.getHttpServer())`
// disparava no-unsafe-argument, e `response.body` sem tipo propagava `any`
// pro resto do teste. `INestApplication<Server>` resolve na ORIGEM (o
// generic ja existe na interface, so nao era usado), sem cast espalhado.
type ConversationListItemBody = {
  id: string;
  messages: Array<{ content: string }>;
};
type SearchResponseBody = { items: ConversationListItemBody[]; nextCursor: string | null };

/**
 * POST /api/admin/conversations/search — contrato da Fase 1, divergencia
 * #4. SEC-07: corpo, nunca query string. Alinhado ao contrato da listagem
 * (achado do usuario, 2026-09-24): {items, nextCursor}, limit opcional
 * (padrao 50, teto 100), cada item no mesmo formato do item da lista
 * (inclui lastMessage) — antes devolvia array puro sem paginacao.
 */
describe('POST /api/admin/conversations/search (e2e)', () => {
  let app: INestApplication<Server>;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let adminCookie: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    await clearLoginRateLimit(moduleRef);
    const email = `admin-search-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Admin Busca', role: 'ADMIN' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    adminCookie = loginResponse.headers['set-cookie'][0];
  });

  it('encontra a conversa pelo NOME do paciente', async () => {
    const suffix = uniquePhone();
    const patient = await prisma.patient.create({ data: { phoneE164: `+${suffix}`, name: `Buscavel Search ${suffix}` } });
    const conversation = await prisma.conversation.create({ data: { patientId: patient.id } });

    const response = await request(app.getHttpServer())
      .post('/api/admin/conversations/search')
      .set('Cookie', adminCookie)
      .send({ query: 'Buscavel Search' });

    expect(response.status).toBe(200);
    const body = response.body as SearchResponseBody;
    expect(body.items.map((c) => c.id)).toContain(conversation.id);
  });

  it('encontra a conversa pelo TELEFONE do paciente', async () => {
    const suffix = uniquePhone();
    const patient = await prisma.patient.create({ data: { phoneE164: `+${suffix}` } });
    const conversation = await prisma.conversation.create({ data: { patientId: patient.id } });

    const response = await request(app.getHttpServer())
      .post('/api/admin/conversations/search')
      .set('Cookie', adminCookie)
      .send({ query: suffix });

    expect(response.status).toBe(200);
    const body = response.body as SearchResponseBody;
    expect(body.items.map((c) => c.id)).toContain(conversation.id);
  });

  it('nunca aceita o termo por query string (SEC-07) — so GET simples, sem body, nao acha nada por acaso', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/admin/conversations/search')
      .set('Cookie', adminCookie)
      .send({});

    expect(response.status).toBe(400);
  });

  it('resposta segue o mesmo contrato da listagem: {items, nextCursor}, item com lastMessage, sem context/toolCalls', async () => {
    const suffix = uniquePhone();
    const patient = await prisma.patient.create({ data: { phoneE164: `+${suffix}`, name: `Buscavel Contrato ${suffix}` } });
    const conversation = await prisma.conversation.create({
      data: { patientId: patient.id, context: { algumDado: 'sensivel' } },
    });
    await prisma.message.create({ data: { conversationId: conversation.id, role: 'AGENT', content: 'ola!' } });

    const response = await request(app.getHttpServer())
      .post('/api/admin/conversations/search')
      .set('Cookie', adminCookie)
      .send({ query: 'Buscavel Contrato' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('items');
    expect(response.body).toHaveProperty('nextCursor');
    const body = response.body as SearchResponseBody;
    const item = body.items.find((c) => c.id === conversation.id);
    expect(item).toBeDefined();
    expect(item?.messages).toHaveLength(1);
    expect(item?.messages[0].content).toBe('ola!');
    expect(item).not.toHaveProperty('context');
  });

  it('`limit` opcional: padrao 50, teto 100 (mesmo comportamento do GET /conversations)', async () => {
    const overLimit = await request(app.getHttpServer())
      .post('/api/admin/conversations/search')
      .set('Cookie', adminCookie)
      .send({ query: 'qualquer coisa', limit: 101 });

    expect(overLimit.status).toBe(400);

    const noLimit = await request(app.getHttpServer())
      .post('/api/admin/conversations/search')
      .set('Cookie', adminCookie)
      .send({ query: 'qualquer coisa' });

    expect(noLimit.status).toBe(200);
  });
});

import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { EMBEDDING_PORT } from '../../src/modules/knowledge';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { clearLoginRateLimit } from '../support/clear-login-rate-limit';
import { configureTestApp } from '../support/configure-test-app';
import { uniquePhone } from '../support/unique-phone';
import { waitFor } from '../support/wait-for';
import { waitForQueueWorkersReady } from '../support/wait-for-queues-ready';
import { FakeEmbeddingPort } from './support/fake-embedding-port';

describe('KnowledgeAdminController (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let adminCookie: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PORT)
      .useValue(new FakeEmbeddingPort())
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
    await clearLoginRateLimit(moduleRef);
    const email = `admin-knowledge-crud-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Admin Knowledge', role: 'ADMIN' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    adminCookie = loginResponse.headers['set-cookie'][0];
  });

  async function waitUntilReady(documentId: string) {
    return waitFor(async () => {
      const doc = await prisma.knowledgeDocument.findUnique({ where: { id: documentId } });
      return doc?.status === 'READY' ? doc : undefined;
    });
  }

  it('POST cria rascunho (202, status PENDING) e o job processa ate READY, active e com chunks', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/admin/knowledge')
      .set('Cookie', adminCookie)
      .send({ title: 'Localizacao da clinica', category: 'localizacao', sourceRef: `localizacao-${uniquePhone()}`, content: 'Fica na Av. Central, 100.' });

    expect(response.status).toBe(202);
    expect(response.body.status).toBe('PENDING');

    await waitUntilReady(response.body.documentId);

    const detail = await request(app.getHttpServer()).get(`/api/admin/knowledge/${response.body.documentId}`).set('Cookie', adminCookie);
    expect(detail.status).toBe(200);
    expect(detail.body.active).toBe(true);
    expect(detail.body.status).toBe('READY');
    expect(detail.body.chunkCount).toBeGreaterThan(0);
  });

  it('PUT cria nova versao com o conteudo novo, desativando a anterior so depois de pronta', async () => {
    const sourceRef = `convenio-${uniquePhone()}`;
    const created = await request(app.getHttpServer())
      .post('/api/admin/knowledge')
      .set('Cookie', adminCookie)
      .send({ title: 'Convenios aceitos', category: 'convenio', sourceRef, content: 'Aceitamos Unimed e Bradesco Saude.' });
    await waitUntilReady(created.body.documentId);

    const updated = await request(app.getHttpServer())
      .put(`/api/admin/knowledge/${created.body.documentId}`)
      .set('Cookie', adminCookie)
      .send({ content: 'Aceitamos Unimed, Bradesco Saude e SulAmerica.' });

    expect(updated.status).toBe(202);
    expect(updated.body.documentId).not.toBe(created.body.documentId);
    expect(updated.body.version).toBe(2);

    await waitUntilReady(updated.body.documentId);

    const oldDoc = await prisma.knowledgeDocument.findUnique({ where: { id: created.body.documentId } });
    const newDoc = await prisma.knowledgeDocument.findUnique({ where: { id: updated.body.documentId } });
    expect(oldDoc?.active).toBe(false);
    expect(newDoc?.active).toBe(true);
    expect(newDoc?.content).toBe('Aceitamos Unimed, Bradesco Saude e SulAmerica.');
  });

  it('reindexar com um rascunho ja PENDING/RUNNING para o mesmo documento retorna 409', async () => {
    const sourceRef = `procedimento-${uniquePhone()}`;
    const created = await request(app.getHttpServer())
      .post('/api/admin/knowledge')
      .set('Cookie', adminCookie)
      .send({ title: 'O que esperar da consulta', category: 'procedimento', sourceRef, content: 'A consulta dura em media 30 minutos.' });
    await waitUntilReady(created.body.documentId);

    // Cria um rascunho pendente na mao (mesmo sourceRef) pra simular uma
    // reindexacao ja em andamento sem depender de ganhar a corrida contra
    // o proprio worker.
    await prisma.knowledgeDocument.create({
      data: {
        title: 'O que esperar da consulta',
        category: 'procedimento',
        sourceRef,
        content: 'rascunho em andamento',
        version: 2,
        active: false,
        status: 'RUNNING',
      },
    });

    const reindexResponse = await request(app.getHttpServer())
      .post(`/api/admin/knowledge/${created.body.documentId}/reindex`)
      .set('Cookie', adminCookie)
      .send();

    expect(reindexResponse.status).toBe(409);
    expect(reindexResponse.body.error.code).toBe('REINDEX_ALREADY_PENDING');
  });

  it('GET list devolve todas as versoes', async () => {
    const response = await request(app.getHttpServer()).get('/api/admin/knowledge').set('Cookie', adminCookie);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  it('GET :id inexistente retorna 404', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/admin/knowledge/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);
    expect(response.status).toBe(404);
  });

  it('POST com documento vazio retorna 400, sem criar rascunho', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/admin/knowledge')
      .set('Cookie', adminCookie)
      .send({ title: 'Vazio', category: 'geral', sourceRef: null, content: '' });

    expect(response.status).toBe(400);
  });

  it('papel RECEPCAO recebe 403 (rota restrita a ADMIN)', async () => {
    const email = `recepcao-knowledge-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Recepcao', role: 'RECEPCAO' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    const recepcaoCookie = loginResponse.headers['set-cookie'][0];

    const response = await request(app.getHttpServer()).get('/api/admin/knowledge').set('Cookie', recepcaoCookie);
    expect(response.status).toBe(403);
  });

  it('sem cookie de sessao retorna 401', async () => {
    const response = await request(app.getHttpServer()).get('/api/admin/knowledge');
    expect(response.status).toBe(401);
  });
});

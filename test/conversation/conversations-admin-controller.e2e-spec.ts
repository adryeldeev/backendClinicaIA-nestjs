import 'reflect-metadata';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { ConversationStatus, MessageRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { clearLoginRateLimit } from '../support/clear-login-rate-limit';
import { configureTestApp } from '../support/configure-test-app';
import { uniquePhone } from '../support/unique-phone';
import { waitForQueueWorkersReady } from '../support/wait-for-queues-ready';

// `INestApplication.getHttpServer()` sem o generic e tipado `any` — ver
// mesmo achado em search-conversations.e2e-spec.ts. `INestApplication<Server>`
// resolve na origem.
describe('ConversationsAdminController + PatientsAdminController (e2e)', () => {
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
    const email = `admin-conv-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Admin Conversas', role: 'ADMIN' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    adminCookie = loginResponse.headers['set-cookie'][0];
  });

  async function createConversation(status: ConversationStatus) {
    const patient = await prisma.patient.create({ data: { phoneE164: `+${uniquePhone()}`, name: `Paciente ${uniquePhone()}` } });
    const conversation = await prisma.conversation.create({ data: { patientId: patient.id, status } });
    return { patient, conversation };
  }

  // MUDANCA DE CONTRATO (2026-09-24, ver SPEC.md secao 5): sem `status`,
  // devolve TODAS as conversas (antes: so AWAITING_HUMAN por default).
  // `limit` agora obrigatorio.
  it('GET /conversations sem filtro de status devolve TODAS (mudanca de contrato 2026-09-24)', async () => {
    const { conversation: awaiting } = await createConversation(ConversationStatus.AWAITING_HUMAN);
    const { conversation: bot } = await createConversation(ConversationStatus.BOT);

    const response = await request(app.getHttpServer())
      .get('/api/admin/conversations?limit=50')
      .set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    const ids = response.body.items.map((c: { id: string }) => c.id);
    expect(ids).toContain(awaiting.id);
    expect(ids).toContain(bot.id);
  });

  // Correcao do usuario (2026-09-24, regressao real achada pelo front):
  // "paginacao obrigatoria" significa "a lista nunca e ilimitada", nao
  // "todo chamador precisa declarar o tamanho". `limit` e opcional agora,
  // com padrao 50 do servidor — omiti-lo tinha virado 400 com
  // "Expected number, received nan" (z.coerce.number() rodando sobre
  // undefined), o oposto do que deveria acontecer no uso normal da API.
  it('GET /conversations sem `limit`: usa o padrao do servidor (50), nunca 400', async () => {
    const response = await request(app.getHttpServer()).get('/api/admin/conversations').set('Cookie', adminCookie);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.items)).toBe(true);
  });

  it('GET /conversations com `limit` acima do teto do servidor (100) retorna 400 com mensagem legivel', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/admin/conversations?limit=999')
      .set('Cookie', adminCookie);
    expect(response.status).toBe(400);
    expect(response.body.error.message.toLowerCase()).not.toContain('nan');
  });

  it('GET /conversations?status=HUMAN filtra pelo status pedido', async () => {
    const { conversation: human } = await createConversation(ConversationStatus.HUMAN);

    const response = await request(app.getHttpServer())
      .get('/api/admin/conversations?status=HUMAN&limit=50')
      .set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    expect(response.body.items.map((c: { id: string }) => c.id)).toContain(human.id);
  });

  it('GET /conversations?status=BOT,HUMAN aceita multiplos valores (divergencia #2)', async () => {
    const { conversation: bot } = await createConversation(ConversationStatus.BOT);
    const { conversation: human } = await createConversation(ConversationStatus.HUMAN);
    const { conversation: awaiting } = await createConversation(ConversationStatus.AWAITING_HUMAN);

    const response = await request(app.getHttpServer())
      .get('/api/admin/conversations?status=BOT,HUMAN&limit=50')
      .set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    const ids = response.body.items.map((c: { id: string }) => c.id);
    expect(ids).toContain(bot.id);
    expect(ids).toContain(human.id);
    expect(ids).not.toContain(awaiting.id);
  });

  it('GET /conversations inclui a ULTIMA mensagem por conversa (lastMessage), sem N+1', async () => {
    const { conversation } = await createConversation(ConversationStatus.BOT);
    await prisma.message.create({ data: { conversationId: conversation.id, role: MessageRole.PATIENT, content: 'primeira' } });
    await prisma.message.create({ data: { conversationId: conversation.id, role: MessageRole.AGENT, content: 'ultima mensagem' } });

    const response = await request(app.getHttpServer())
      .get('/api/admin/conversations?status=BOT&limit=50')
      .set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    const item = response.body.items.find((c: { id: string }) => c.id === conversation.id);
    expect(item.messages).toHaveLength(1);
    expect(item.messages[0].content).toBe('ultima mensagem');
  });

  it('GET /conversations pagina por cursor (updatedAt+id) sem repetir nem pular itens', async () => {
    const created = [];
    for (let i = 0; i < 3; i++) {
      created.push(await createConversation(ConversationStatus.BOT));
    }

    const firstPage = await request(app.getHttpServer())
      .get('/api/admin/conversations?status=BOT&limit=1')
      .set('Cookie', adminCookie);
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items).toHaveLength(1);
    expect(firstPage.body.nextCursor).toBeTruthy();

    const secondPage = await request(app.getHttpServer())
      .get(`/api/admin/conversations?status=BOT&limit=1&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`)
      .set('Cookie', adminCookie);
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.items[0].id).not.toBe(firstPage.body.items[0].id);
  });

  it('GET /conversations com cursor malformado retorna 400, nao 500', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/admin/conversations?limit=10&cursor=isso-nao-e-um-cursor-valido')
      .set('Cookie', adminCookie);
    expect(response.status).toBe(400);
  });

  // Achado do usuario: 500 real reportado pelo front em producao (banco
  // `clinica`), reproduzido depois como janela entre codigo novo e
  // migration — mas os dois casos de dado seguem sendo o tipo que producao
  // vai ter de verdade, e valem teste permanente independente da causa raiz.
  it('conversa SEM nenhuma mensagem aparece na lista com messages:[] (nao quebra o take:1)', async () => {
    const { conversation } = await createConversation(ConversationStatus.BOT);

    const response = await request(app.getHttpServer())
      .get('/api/admin/conversations?status=BOT&limit=50')
      .set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    const item = response.body.items.find((c: { id: string }) => c.id === conversation.id);
    expect(item).toBeTruthy();
    expect(item.messages).toEqual([]);
  });

  it('paciente com name NULL aparece na lista, na busca e no detalhe sem quebrar', async () => {
    const phone = `+${uniquePhone()}`;
    const patient = await prisma.patient.create({ data: { phoneE164: phone } }); // name omitido de proposito (String? no schema)
    const conversation = await prisma.conversation.create({ data: { patientId: patient.id, status: ConversationStatus.BOT } });

    const listResponse = await request(app.getHttpServer())
      .get('/api/admin/conversations?status=BOT&limit=50')
      .set('Cookie', adminCookie);
    expect(listResponse.status).toBe(200);
    const item = listResponse.body.items.find((c: { id: string }) => c.id === conversation.id);
    expect(item.patient.name).toBeNull();

    const searchResponse = await request(app.getHttpServer())
      .post('/api/admin/conversations/search')
      .set('Cookie', adminCookie)
      .send({ query: phone });
    expect(searchResponse.status).toBe(200);

    const detailResponse = await request(app.getHttpServer())
      .get(`/api/admin/conversations/${conversation.id}`)
      .set('Cookie', adminCookie);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.conversation.patient.name).toBeNull();
  });

  it('GET /conversations/:id devolve o historico completo de mensagens', async () => {
    const { conversation } = await createConversation(ConversationStatus.BOT);
    await prisma.message.create({ data: { conversationId: conversation.id, role: MessageRole.PATIENT, content: 'oi' } });
    await prisma.message.create({ data: { conversationId: conversation.id, role: MessageRole.AGENT, content: 'ola!' } });

    const response = await request(app.getHttpServer())
      .get(`/api/admin/conversations/${conversation.id}`)
      .set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    expect(response.body.conversation.id).toBe(conversation.id);
    expect(response.body.messages).toHaveLength(2);
  });

  /**
   * Achado do usuario (2026-09-24): `context` (dados coletados parciais do
   * paciente) e `toolCalls` (identificador interno + raciocinio do modelo)
   * trafegavam pro navegador — o front descartava no schema, mas isso nao
   * impede o dado de aparecer no devtools/log de proxy (espirito SEC-02).
   * Cria com valor REAL nos dois campos (nao so o default vazio) pra provar
   * que sumiu de verdade, nao que so nunca existiu.
   */
  it('GET /conversations/:id NUNCA devolve context nem toolCalls, mesmo quando tem valor real (SEC-02)', async () => {
    const { patient, conversation } = await createConversation(ConversationStatus.BOT);
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { context: { nomeColetado: patient.name, telefoneConfirmado: true } },
    });
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: MessageRole.AGENT,
        content: 'ola!',
        toolCalls: [{ id: '1', name: 'listar_procedimentos', arguments: {} }],
      },
    });

    const response = await request(app.getHttpServer())
      .get(`/api/admin/conversations/${conversation.id}`)
      .set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    expect(response.body.conversation).not.toHaveProperty('context');
    for (const message of response.body.messages) {
      expect(message).not.toHaveProperty('toolCalls');
    }
  });

  it('GET /conversations (lista) tambem nunca devolve context, mesmo caminho da SEC-02', async () => {
    const { conversation } = await createConversation(ConversationStatus.BOT);
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { context: { algumDado: 'sensivel' } },
    });

    const response = await request(app.getHttpServer())
      .get('/api/admin/conversations?limit=50')
      .set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    const item = response.body.items.find((i: { id: string }) => i.id === conversation.id);
    expect(item).not.toHaveProperty('context');
  });

  it('POST /:id/takeover: AWAITING_HUMAN vira HUMAN, fecha o HandoffTicket aberto e marca quem assumiu (divergencia #6)', async () => {
    const { conversation } = await createConversation(ConversationStatus.AWAITING_HUMAN);
    const ticket = await prisma.handoffTicket.create({
      data: { conversationId: conversation.id, reason: 'RN-01', summary: 'teste' },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/admin/conversations/${conversation.id}/takeover`)
      .set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(ConversationStatus.HUMAN);
    expect(response.body.assignedUserId).toBeTruthy();

    const ticketAfter = await prisma.handoffTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(ticketAfter.resolvedAt).not.toBeNull();
  });

  // MUDANCA DE COMPORTAMENTO (divergencia #7): antes retornava 409. Achado
  // do front — a recepcionista pode querer assumir uma conversa que esta
  // com a IA sem mandar mensagem (hoje a unica saida era responder, que ja
  // e assuncao implicita via RN-26). As duas formas agora coexistem.
  it('POST /:id/takeover a partir de BOT (sem escalada previa) agora e permitido', async () => {
    const { conversation } = await createConversation(ConversationStatus.BOT);

    const response = await request(app.getHttpServer())
      .post(`/api/admin/conversations/${conversation.id}/takeover`)
      .set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(ConversationStatus.HUMAN);
    expect(response.body.assignedUserId).toBeTruthy();
  });

  it('POST /:id/takeover a partir de CLOSED continua rejeitado (409)', async () => {
    const { conversation } = await createConversation(ConversationStatus.CLOSED);

    const response = await request(app.getHttpServer())
      .post(`/api/admin/conversations/${conversation.id}/takeover`)
      .set('Cookie', adminCookie);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_CONVERSATION_TRANSITION');
  });

  it('POST /:id/release: HUMAN vira BOT e limpa quem estava assumindo (divergencia #6)', async () => {
    const { conversation } = await createConversation(ConversationStatus.HUMAN);
    const someUser = await prisma.user.create({
      data: { email: `assigned-${uniquePhone()}@clinica.test`, passwordHash: 'x', name: 'Ja Assumiu', role: 'RECEPCAO' },
    });
    await prisma.conversation.update({ where: { id: conversation.id }, data: { assignedUserId: someUser.id } });

    const response = await request(app.getHttpServer())
      .post(`/api/admin/conversations/${conversation.id}/release`)
      .set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe(ConversationStatus.BOT);
    expect(response.body.assignedUserId).toBeNull();
  });

  it('POST /:id/release a partir de BOT (nao HUMAN) retorna 409', async () => {
    const { conversation } = await createConversation(ConversationStatus.BOT);

    const response = await request(app.getHttpServer())
      .post(`/api/admin/conversations/${conversation.id}/release`)
      .set('Cookie', adminCookie);

    expect(response.status).toBe(409);
  });

  it('POST /patients/search encontra por nome parcial e por telefone', async () => {
    const suffix = uniquePhone();
    const patient = await prisma.patient.create({
      data: { phoneE164: `+${suffix}`, name: `Fulano Buscavel ${suffix}` },
    });

    const byName = await request(app.getHttpServer())
      .post('/api/admin/patients/search')
      .set('Cookie', adminCookie)
      .send({ query: 'Buscavel' });
    expect(byName.status).toBe(200);
    expect(byName.body.map((p: { id: string }) => p.id)).toContain(patient.id);

    const byPhone = await request(app.getHttpServer())
      .post('/api/admin/patients/search')
      .set('Cookie', adminCookie)
      .send({ query: suffix });
    expect(byPhone.body.map((p: { id: string }) => p.id)).toContain(patient.id);
  });

  it('papel PROFISSIONAL recebe 403 na fila de conversas (rota restrita a ADMIN/RECEPCAO)', async () => {
    const email = `prof-conv-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Prof Conversas', role: 'PROFISSIONAL' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    const cookie = loginResponse.headers['set-cookie'][0];

    const response = await request(app.getHttpServer()).get('/api/admin/conversations').set('Cookie', cookie);
    expect(response.status).toBe(403);
  });
});

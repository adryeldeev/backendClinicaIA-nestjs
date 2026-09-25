import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { ConversationStatus, MessageRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { MESSAGING_PORT } from '../../src/modules/messaging';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { clearLoginRateLimit } from '../support/clear-login-rate-limit';
import { configureTestApp } from '../support/configure-test-app';
import { FakeMessagingPort } from '../support/fake-messaging-port';
import { uniquePhone } from '../support/unique-phone';
import { waitFor } from '../support/wait-for';
import { waitForQueueWorkersReady } from '../support/wait-for-queues-ready';

const HOUR_MS = 60 * 60 * 1000;

/**
 * POST /api/admin/conversations/:id/messages (decisao 2 do plano da
 * Etapa 1: controller mora em messaging por causa do outbox). Cobre RN-26
 * (assuncao implicita) e RN-18 (janela de 24h checada sincronamente).
 */
describe('AdminMessagesAdminController — RN-26 + RN-18 (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let fakeMessagingPort: FakeMessagingPort;
  let adminCookie: string;
  let adminUserId: string;

  beforeAll(async () => {
    fakeMessagingPort = new FakeMessagingPort();
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_PORT)
      .useValue(fakeMessagingPort)
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
    const email = `admin-msg-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    const admin = await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Admin Mensagens', role: 'ADMIN' },
    });
    adminUserId = admin.id;
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    adminCookie = loginResponse.headers['set-cookie'][0];
  });

  async function createConversation(status: ConversationStatus, windowExpiresAt: Date | null) {
    const phone = `+${uniquePhone()}`;
    const patient = await prisma.patient.create({ data: { phoneE164: phone } });
    const conversation = await prisma.conversation.create({
      data: { patientId: patient.id, status, lastInboundAt: new Date(), windowExpiresAt },
    });
    return { phone, patient, conversation };
  }

  it('RN-26: mandar mensagem numa conversa em BOT vira HUMAN sozinho, sem takeover explicito', async () => {
    const { phone, conversation } = await createConversation(ConversationStatus.BOT, new Date(Date.now() + 23 * HOUR_MS));

    const response = await request(app.getHttpServer())
      .post(`/api/admin/conversations/${conversation.id}/messages`)
      .set('Cookie', adminCookie)
      .send({ body: 'Oi, aqui e a recepcao!' });

    expect(response.status).toBe(201);

    const conversationAfter = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conversationAfter.status).toBe(ConversationStatus.HUMAN);

    const humanMessage = await prisma.message.findFirstOrThrow({
      where: { conversationId: conversation.id, role: MessageRole.HUMAN },
    });
    expect(humanMessage.content).toBe('Oi, aqui e a recepcao!');
    // Contrato da Fase 1: quem mandou (divergencia #6) e o outbox que vai
    // entregar (divergencia #5), setados na CRIACAO — nunca depois.
    expect(humanMessage.authorUserId).toBe(adminUserId);
    expect(humanMessage.outboxMessageId).toBeTruthy();
    const linkedOutbox = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: humanMessage.outboxMessageId! } });
    expect(linkedOutbox.toPhoneE164).toBe(phone);
    expect(linkedOutbox.body).toBe('Oi, aqui e a recepcao!');
    expect(conversationAfter.assignedUserId).toBe(adminUserId);

    const sent = await waitFor(() => Promise.resolve(fakeMessagingPort.sentMessages.find((m) => m.to === phone)));
    expect(sent.body).toBe('Oi, aqui e a recepcao!');
  });

  it('RN-26: mandar mensagem numa conversa AWAITING_HUMAN tambem vira HUMAN e fecha o ticket', async () => {
    const { phone, conversation } = await createConversation(ConversationStatus.AWAITING_HUMAN, new Date(Date.now() + 23 * HOUR_MS));
    const ticket = await prisma.handoffTicket.create({
      data: { conversationId: conversation.id, reason: 'RN-01', summary: 'teste' },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/admin/conversations/${conversation.id}/messages`)
      .set('Cookie', adminCookie)
      .send({ body: 'Assumindo por aqui.' });

    expect(response.status).toBe(201);
    const conversationAfter = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conversationAfter.status).toBe(ConversationStatus.HUMAN);
    const ticketAfter = await prisma.handoffTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(ticketAfter.resolvedAt).not.toBeNull();

    // Espera o outbox despachar antes do proximo teste/afterAll — sem isso
    // o job pode ficar `waiting` no Redis (compartilhado entre arquivos) e
    // ser processado por outro arquivo depois, inflando o sentMessages dele.
    await waitFor(() => Promise.resolve(fakeMessagingPort.sentMessages.find((m) => m.to === phone)));
  });

  it('conversa ja em HUMAN: mandar mensagem nao mexe no status (idempotente)', async () => {
    const { phone, conversation } = await createConversation(ConversationStatus.HUMAN, new Date(Date.now() + 23 * HOUR_MS));

    const response = await request(app.getHttpServer())
      .post(`/api/admin/conversations/${conversation.id}/messages`)
      .set('Cookie', adminCookie)
      .send({ body: 'Continuando o atendimento.' });

    expect(response.status).toBe(201);
    const conversationAfter = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conversationAfter.status).toBe(ConversationStatus.HUMAN);

    await waitFor(() => Promise.resolve(fakeMessagingPort.sentMessages.find((m) => m.to === phone)));
  });

  it('RN-18: janela de 24h expirada retorna 409 e nao enfileira nada', async () => {
    const { conversation } = await createConversation(ConversationStatus.BOT, new Date(Date.now() - HOUR_MS));

    const response = await request(app.getHttpServer())
      .post(`/api/admin/conversations/${conversation.id}/messages`)
      .set('Cookie', adminCookie)
      .send({ body: 'Isso nao deveria ir.' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('WINDOW_EXPIRED');

    const conversationAfter = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conversationAfter.status).toBe(ConversationStatus.BOT); // RN-26 nao roda se a janela ja rejeitou antes

    const humanMessages = await prisma.message.count({
      where: { conversationId: conversation.id, role: MessageRole.HUMAN },
    });
    expect(humanMessages).toBe(0);
  });

  it('papel PROFISSIONAL recebe 403 (rota restrita a ADMIN/RECEPCAO)', async () => {
    const { conversation } = await createConversation(ConversationStatus.BOT, new Date(Date.now() + 23 * HOUR_MS));
    const email = `prof-msg-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Prof Mensagens', role: 'PROFISSIONAL' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    const cookie = loginResponse.headers['set-cookie'][0];

    const response = await request(app.getHttpServer())
      .post(`/api/admin/conversations/${conversation.id}/messages`)
      .set('Cookie', cookie)
      .send({ body: 'Tentando mandar.' });

    expect(response.status).toBe(403);
  });
});

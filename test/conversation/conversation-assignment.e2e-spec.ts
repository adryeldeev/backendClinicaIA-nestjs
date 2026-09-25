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
 * Contrato da Fase 1, divergencia #6 ("quem assumiu") — achado do front: sem
 * `assignedUserId`, o cenario da SPEC.md secao 12 (duas recepcionistas) nao
 * aparece na tela. Estes testes provam a VISIBILIDADE (a lista mostra quem
 * assumiu), nao um bloqueio — nao foi pedido travar uma 2a pessoa de agir,
 * so que a tela pare de esconder que alguem ja assumiu.
 */
describe('Duas recepcionistas — assignedUserId na lista e no autor da mensagem (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let fakeMessagingPort: FakeMessagingPort;

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
  });

  async function loginAsNewReceptionist(label: string): Promise<{ cookie: string; userId: string }> {
    const email = `recepcao-${label}-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    const user = await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: `Recepcao ${label}`, role: 'RECEPCAO' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    return { cookie: loginResponse.headers['set-cookie'][0], userId: user.id };
  }

  it('recepcionista A assume; a LISTA mostra pra recepcionista B que A ja assumiu', async () => {
    const recepcaoA = await loginAsNewReceptionist('a');
    const recepcaoB = await loginAsNewReceptionist('b');

    const patient = await prisma.patient.create({ data: { phoneE164: `+${uniquePhone()}` } });
    const conversation = await prisma.conversation.create({
      data: { patientId: patient.id, status: ConversationStatus.AWAITING_HUMAN },
    });

    const takeoverResponse = await request(app.getHttpServer())
      .post(`/api/admin/conversations/${conversation.id}/takeover`)
      .set('Cookie', recepcaoA.cookie);
    expect(takeoverResponse.status).toBe(200);
    expect(takeoverResponse.body.assignedUserId).toBe(recepcaoA.userId);

    // B consulta a lista (a mesma caixa de entrada) e ve quem ja assumiu —
    // achado do front: sem isso, B nao tinha como saber e podia responder
    // por cima de A na mesma conversa.
    const listResponse = await request(app.getHttpServer())
      .get('/api/admin/conversations?status=HUMAN&limit=50')
      .set('Cookie', recepcaoB.cookie);
    expect(listResponse.status).toBe(200);
    const item = listResponse.body.items.find((c: { id: string }) => c.id === conversation.id);
    expect(item).toBeTruthy();
    expect(item.assignedUser).toMatchObject({ id: recepcaoA.userId, name: 'Recepcao a' });
  });

  it('recepcionista B manda mensagem numa conversa ja HUMAN de A — assignedUserId passa pra B (RN-26 implicito atualiza)', async () => {
    const recepcaoA = await loginAsNewReceptionist('a2');
    const recepcaoB = await loginAsNewReceptionist('b2');

    const phone = `+${uniquePhone()}`;
    const patient = await prisma.patient.create({ data: { phoneE164: phone } });
    const conversation = await prisma.conversation.create({
      data: {
        patientId: patient.id,
        status: ConversationStatus.HUMAN,
        assignedUserId: recepcaoA.userId,
        windowExpiresAt: new Date(Date.now() + 23 * HOUR_MS),
      },
    });

    const response = await request(app.getHttpServer())
      .post(`/api/admin/conversations/${conversation.id}/messages`)
      .set('Cookie', recepcaoB.cookie)
      .send({ body: 'Assumindo daqui pra frente.' });
    expect(response.status).toBe(201);

    // Espera o outbox despachar de verdade antes de seguir — achado ao
    // rodar a suite completa: sem isso, o job podia ainda estar `waiting`
    // no Redis (compartilhado entre arquivos de teste) quando este
    // afterAll fechasse o worker, e um arquivo POSTERIOR acabava
    // processando esse job orfao com o PROPRIO FakeMessagingPort dele —
    // um "sentMessages" a mais em teste nenhuma relacao com este.
    await waitFor(() => Promise.resolve(fakeMessagingPort.sentMessages.find((m) => m.to === phone)));

    const conversationAfter = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conversationAfter.assignedUserId).toBe(recepcaoB.userId);

    const message = await prisma.message.findFirstOrThrow({
      where: { conversationId: conversation.id, role: MessageRole.HUMAN },
    });
    expect(message.authorUserId).toBe(recepcaoB.userId);
  });
});

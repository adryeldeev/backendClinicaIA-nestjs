import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { AppointmentStatus, ConversationStatus, UserRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { clearLoginRateLimit } from '../support/clear-login-rate-limit';
import { configureTestApp } from '../support/configure-test-app';
import { uniquePhone } from '../support/unique-phone';
import { waitForQueueWorkersReady } from '../support/wait-for-queues-ready';

// Janela deliberadamente larga (nao "mes corrente") pra que os testes de
// agregacao sejam independentes de que dia real e hoje — o default do
// endpoint (sem from/to) e testado a parte, isolado, so pra essa logica.
const WIDE_FROM = new Date('2020-01-01T00:00:00.000Z').toISOString();
const WIDE_TO = new Date('2030-01-01T00:00:00.000Z').toISOString();

describe('MetricsAdminController — GET /api/admin/metrics (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  let clinicId: string;
  let professionalId: string;
  let procedureId: string;
  let patientId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureTestApp(app);
    prisma = moduleRef.get(PrismaService);
    await app.init();
    await waitForQueueWorkersReady(moduleRef);

    const suffix = uniquePhone();
    const clinic = await prisma.clinic.create({
      data: { name: `Clinica Metrics Teste ${suffix}`, timezone: 'America/Fortaleza', addressLine: 'Rua Teste', phone: `+${suffix}` },
    });
    clinicId = clinic.id;
    const professional = await prisma.professional.create({
      data: { clinicId, name: `Profissional Metrics ${suffix}`, specialty: 'Teste' },
    });
    professionalId = professional.id;
    const procedure = await prisma.procedure.create({
      data: { clinicId, name: `Procedimento Metrics ${suffix}`, durationMin: 30 },
    });
    procedureId = procedure.id;
    const patient = await prisma.patient.create({ data: { phoneE164: `+${uniquePhone()}` } });
    patientId = patient.id;

    // 2 conversas sem HandoffTicket — "concluidas sem escalada".
    await prisma.conversation.create({ data: { patientId, status: ConversationStatus.CLOSED } });
    await prisma.conversation.create({ data: { patientId, status: ConversationStatus.CLOSED } });

    // 1 conversa QUE escalou (RN-02) — conta no total, nao em "sem escalada".
    const escalated = await prisma.conversation.create({ data: { patientId, status: ConversationStatus.AWAITING_HUMAN } });
    await prisma.handoffTicket.create({
      data: { conversationId: escalated.id, reason: 'RN-02', summary: 'Sinal de urgencia detectado.' },
    });

    // Slots escalonados (30min cada) — mesmo profissional, constraint de
    // exclusao (appointment_no_overlap) rejeita horarios iguais/sobrepostos.
    function slot(offsetSlots: number): { startsAt: Date; endsAt: Date } {
      const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + offsetSlots * 30 * 60 * 1000);
      return { startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000) };
    }

    // 1 agendamento do AGENTE — conta em agendamentosPeloAgente.
    await prisma.appointment.create({
      data: { professionalId, patientId, procedureId, ...slot(0), status: AppointmentStatus.CONFIRMED, createdBy: 'agent' },
    });

    // 1 agendamento MANUAL (humano) — NAO conta em agendamentosPeloAgente.
    await prisma.appointment.create({
      data: { professionalId, patientId, procedureId, ...slot(1), status: AppointmentStatus.CONFIRMED, createdBy: 'human' },
    });

    // 1 remarcacao do agente (cancelReason='Remarcado') — conta em
    // remarcacoesPeloAgente, NAO em cancelamentosPeloAgente.
    const rescheduled = await prisma.appointment.create({
      data: { professionalId, patientId, procedureId, ...slot(2), status: AppointmentStatus.CONFIRMED, createdBy: 'agent' },
    });
    // updatedAt e @updatedAt (Prisma sempre sobrescreve no update/create,
    // nao aceita valor explicito) — SQL cru pra garantir que cai dentro da
    // janela ampla do teste independente de quando a suite roda de verdade.
    await prisma.$executeRaw`
      UPDATE "Appointment" SET status = 'CANCELLED', "cancelReason" = 'Remarcado', "updatedAt" = now()
      WHERE id = ${rescheduled.id}
    `;

    // 1 cancelamento de verdade do agente — conta em cancelamentosPeloAgente.
    const cancelled = await prisma.appointment.create({
      data: { professionalId, patientId, procedureId, ...slot(3), status: AppointmentStatus.CONFIRMED, createdBy: 'agent' },
    });
    await prisma.$executeRaw`
      UPDATE "Appointment" SET status = 'CANCELLED', "cancelReason" = 'Desistiu', "updatedAt" = now()
      WHERE id = ${cancelled.id}
    `;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await clearLoginRateLimit(moduleRef);
  });

  async function loginAs(role: UserRole): Promise<string> {
    const email = `${role.toLowerCase()}-metrics-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: `Teste ${role}`, role },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    return loginResponse.headers['set-cookie'][0];
  }

  it('ADMIN ve as metricas agregadas do periodo pedido', async () => {
    const cookie = await loginAs('ADMIN');

    const response = await request(app.getHttpServer())
      .get(`/api/admin/metrics?from=${encodeURIComponent(WIDE_FROM)}&to=${encodeURIComponent(WIDE_TO)}`)
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.conversas.total).toBeGreaterThanOrEqual(3);
    expect(response.body.conversas.concluidasSemEscalada).toBeGreaterThanOrEqual(2);
    expect(response.body.motivosDeEscalada).toEqual(
      expect.arrayContaining([expect.objectContaining({ motivo: 'RN-02', quantidade: expect.any(Number) })]),
    );
    const rn02 = response.body.motivosDeEscalada.find((m: { motivo: string }) => m.motivo === 'RN-02');
    expect(rn02.quantidade).toBeGreaterThanOrEqual(1);

    // O PONTO CENTRAL do achado de createdBy: so o agendamento com
    // createdBy='agent' conta — o manual (createdBy='human') fica de fora.
    expect(response.body.agendamentosPeloAgente).toBeGreaterThanOrEqual(1);
    expect(response.body.remarcacoesPeloAgente).toBeGreaterThanOrEqual(1);
    expect(response.body.cancelamentosPeloAgente).toBeGreaterThanOrEqual(1);
  });

  it('RECEPCAO tambem tem acesso (papel permitido)', async () => {
    const cookie = await loginAs('RECEPCAO');

    const response = await request(app.getHttpServer())
      .get(`/api/admin/metrics?from=${encodeURIComponent(WIDE_FROM)}&to=${encodeURIComponent(WIDE_TO)}`)
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
  });

  it('PROFISSIONAL recebe 403 (rota restrita a ADMIN/RECEPCAO)', async () => {
    const cookie = await loginAs('PROFISSIONAL');

    const response = await request(app.getHttpServer()).get('/api/admin/metrics').set('Cookie', cookie);

    expect(response.status).toBe(403);
  });

  it('sem cookie de sessao retorna 401', async () => {
    const response = await request(app.getHttpServer()).get('/api/admin/metrics');
    expect(response.status).toBe(401);
  });

  it('sem from/to, o periodo default e o mes corrente (dia 1 00:00 UTC ate agora)', async () => {
    const cookie = await loginAs('ADMIN');

    const now = new Date();
    const expectedFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const response = await request(app.getHttpServer()).get('/api/admin/metrics').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(new Date(response.body.periodo.de).getTime()).toBe(expectedFrom.getTime());
  });
});

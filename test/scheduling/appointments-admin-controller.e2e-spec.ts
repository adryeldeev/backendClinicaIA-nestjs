import 'reflect-metadata';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { AppointmentStatus, UserRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { clearLoginRateLimit } from '../support/clear-login-rate-limit';
import { configureTestApp } from '../support/configure-test-app';
import { uniquePhone } from '../support/unique-phone';
import { waitForQueueWorkersReady } from '../support/wait-for-queues-ready';

type ErrorBody = { error: { code: string; message: string } };

/**
 * Criterio de aceite #14 (secao 5/16): usuario PROFISSIONAL que pede a
 * agenda de outro profissional recebe 403 ou lista vazia, NUNCA os dados.
 * O ponto central destes testes e provar que o filtro nao pode ser
 * escapado nem trocando o parametro da query nem batendo direto no id da
 * consulta de outro profissional — nao so que o endpoint "funciona".
 */
describe('AppointmentsAdminController — escopo de professionalId (e2e)', () => {
  let app: INestApplication<Server>;
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  let clinicId: string;
  let professionalAId: string;
  let professionalBId: string;
  let procedureId: string;
  let patientId: string;
  let appointmentOfAId: string;
  let appointmentOfBId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureTestApp(app);
    prisma = moduleRef.get(PrismaService);
    await app.init();
    await waitForQueueWorkersReady(moduleRef);

    const suffix = uniquePhone();
    const clinic = await prisma.clinic.create({
      data: { name: `Clinica Admin Teste ${suffix}`, timezone: 'America/Fortaleza', addressLine: 'Rua Teste', phone: `+${suffix}` },
    });
    clinicId = clinic.id;

    const professionalA = await prisma.professional.create({
      data: { clinicId, name: `Profissional A ${suffix}`, specialty: 'Teste' },
    });
    const professionalB = await prisma.professional.create({
      data: { clinicId, name: `Profissional B ${suffix}`, specialty: 'Teste' },
    });
    professionalAId = professionalA.id;
    professionalBId = professionalB.id;

    // Sem regra de disponibilidade, ListAvailableSlotsUseCase nunca gera
    // candidato nenhum — CreateManualAppointmentUseCase (via HoldSlotUseCase)
    // rejeitaria qualquer horario com InvalidSlotError. So o teste de criacao
    // manual precisa disso; os outros usam Appointment criado direto.
    const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
    await prisma.availabilityRule.createMany({
      data: ALL_WEEKDAYS.map((weekday) => ({
        professionalId: professionalAId,
        weekday,
        startTime: '00:00',
        endTime: '23:30',
        slotMinutes: 30,
      })),
    });

    const procedure = await prisma.procedure.create({
      data: { clinicId, name: `Procedimento Teste ${suffix}`, durationMin: 30 },
    });
    procedureId = procedure.id;

    const patient = await prisma.patient.create({ data: { phoneE164: `+${uniquePhone()}` } });
    patientId = patient.id;

    // Uma consulta CONFIRMADA pra cada profissional — criadas direto (nao
    // via HoldSlotUseCase), o que importa aqui e o filtro de leitura/acao,
    // nao o fluxo de reserva.
    const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const appointmentOfA = await prisma.appointment.create({
      data: { professionalId: professionalAId, patientId, procedureId, startsAt, endsAt, status: AppointmentStatus.CONFIRMED },
    });
    const appointmentOfB = await prisma.appointment.create({
      data: { professionalId: professionalBId, patientId, procedureId, startsAt, endsAt, status: AppointmentStatus.CONFIRMED },
    });
    appointmentOfAId = appointmentOfA.id;
    appointmentOfBId = appointmentOfB.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // Varios testes deste arquivo fazem login (loginAs) — mais de 5 no total,
  // estourando LOGIN_RATE_LIMIT (5/15min) se nao resetar entre eles. Rate
  // limit nao e o que este arquivo testa.
  beforeEach(async () => {
    await clearLoginRateLimit(moduleRef);
  });

  async function loginAs(role: UserRole, professionalId?: string): Promise<string> {
    const email = `${role.toLowerCase()}-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: `Teste ${role}`, role, professionalId },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    return loginResponse.headers['set-cookie'][0];
  }

  function dateRangeQuery(): string {
    const from = new Date(Date.now()).toISOString();
    const to = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  }

  it('ADMIN sem filtro ve as consultas dos DOIS profissionais', async () => {
    const cookie = await loginAs('ADMIN');

    const response = await request(app.getHttpServer())
      .get(`/api/admin/appointments?${dateRangeQuery()}`)
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    const ids = (response.body as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining([appointmentOfAId, appointmentOfBId]));
  });

  it('PROFISSIONAL sem filtro so ve a PROPRIA agenda', async () => {
    const cookie = await loginAs('PROFISSIONAL', professionalAId);

    const response = await request(app.getHttpServer())
      .get(`/api/admin/appointments?${dateRangeQuery()}`)
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    const ids = (response.body as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toContain(appointmentOfAId);
    expect(ids).not.toContain(appointmentOfBId);
  });

  /**
   * O TESTE que prova que o desenho nao pode ser escapado: profissional A
   * pede EXPLICITAMENTE a agenda do profissional B pela query string.
   * Se algum dia um dev distraido trocar ListAppointmentsUseCase pra so
   * repassar requestedProfessionalId direto pro repositorio sem passar
   * por resolveAppointmentScope, ESTE teste falha.
   */
  it('PROFISSIONAL pedindo explicitamente ?professionalId=<outro> continua so vendo a propria agenda', async () => {
    const cookie = await loginAs('PROFISSIONAL', professionalAId);

    const response = await request(app.getHttpServer())
      .get(`/api/admin/appointments?${dateRangeQuery()}&professionalId=${professionalBId}`)
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
    const ids = (response.body as Array<{ id: string }>).map((a) => a.id);
    expect(ids).not.toContain(appointmentOfBId);
    expect(ids).toContain(appointmentOfAId);
  });

  it('PROFISSIONAL consegue cancelar consulta da PROPRIA agenda', async () => {
    const cookie = await loginAs('PROFISSIONAL', professionalAId);

    const response = await request(app.getHttpServer())
      .post(`/api/admin/appointments/${appointmentOfAId}/cancel`)
      .set('Cookie', cookie)
      .send({ reason: 'teste' });

    expect(response.status).toBe(200);
    const cancelled = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentOfAId } });
    expect(cancelled.status).toBe(AppointmentStatus.CANCELLED);
  });

  it('PROFISSIONAL recebe 403 ao tentar cancelar consulta de OUTRO profissional — bate direto no id, sem passar pela lista', async () => {
    const cookie = await loginAs('PROFISSIONAL', professionalAId);

    const response = await request(app.getHttpServer())
      .post(`/api/admin/appointments/${appointmentOfBId}/cancel`)
      .set('Cookie', cookie)
      .send({ reason: 'tentando cancelar agenda alheia' });

    expect(response.status).toBe(403);
    expect((response.body as ErrorBody).error.code).toBe('APPOINTMENT_OUT_OF_SCOPE');
    const stillConfirmed = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentOfBId } });
    expect(stillConfirmed.status).toBe(AppointmentStatus.CONFIRMED);
  });

  it('RECEPCAO consegue criar consulta manual ja confirmada', async () => {
    const cookie = await loginAs('RECEPCAO');

    // Achado real (nao causado pelas mudancas desta sessao, confirmado
    // rodando contra o commit anterior): alignedFutureSlot(new Date(), ...)
    // arredonda em UTC puro, sem noção de fuso. A regra do profissional A
    // e "00:00-23:30 horario local" (America/Fortaleza, UTC-3) — se o
    // horario real em que a suite roda fizer o arredondamento cair entre
    // 23:30 e 00:00 local, o slot gerado fica FORA da grade (RN-06),
    // mesmo com todos os dias da semana cobertos. Fixando um horario
    // seguro (14h UTC = 11h local, meio do dia) elimina a dependencia do
    // relogio real em vez de so ampliar margem.
    const startsAt = new Date();
    startsAt.setUTCDate(startsAt.getUTCDate() + 5);
    startsAt.setUTCHours(14, 0, 0, 0);

    const response = await request(app.getHttpServer())
      .post('/api/admin/appointments')
      .set('Cookie', cookie)
      .send({ patientId, professionalId: professionalAId, procedureId, startsAt: startsAt.toISOString() });

    expect(response.status).toBe(201);
    const created = await prisma.appointment.findUniqueOrThrow({
      where: { id: (response.body as { appointmentId: string }).appointmentId },
    });
    expect(created.status).toBe(AppointmentStatus.CONFIRMED);
    expect(created.createdAt).toBeTruthy();
    // Achado da Fase 6 (metricas de resolucao): createdBy existia desde a
    // Fase 2 mas nunca era setado — toda consulta, inclusive as manuais
    // do painel, caia no default "agent" da coluna. Regressao fixada aqui.
    expect(created.createdBy).toBe('human');
  });

  it('PROFISSIONAL recebe 403 ao tentar criar consulta manual (fora do RBAC da rota)', async () => {
    const cookie = await loginAs('PROFISSIONAL', professionalAId);
    const startsAt = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);

    const response = await request(app.getHttpServer())
      .post('/api/admin/appointments')
      .set('Cookie', cookie)
      .send({ patientId, professionalId: professionalAId, procedureId, startsAt: startsAt.toISOString() });

    expect(response.status).toBe(403);
  });

  /**
   * Achado do usuario (2026-09-25): from/to invertidos devolvia 200 com
   * lista vazia — silenciava um erro de calculo de data da propria tela.
   * Agora rejeita explicitamente, tanto em /appointments quanto em
   * /availability (mesmo buraco, mesmo controller).
   */
  it('GET /appointments com from/to invertidos (to antes de from) responde 400, nao 200 vazio', async () => {
    const cookie = await loginAs('ADMIN');
    const from = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now()).toISOString();

    const response = await request(app.getHttpServer())
      .get(`/api/admin/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set('Cookie', cookie);

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).error.message).toContain('não pode ser anterior');
  });

  it('GET /appointments com intervalo acima de 92 dias responde 400 (sem teto, um intervalo aberto permitia pedir uma decada de agenda)', async () => {
    const cookie = await loginAs('ADMIN');
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000).toISOString();

    const response = await request(app.getHttpServer())
      .get(`/api/admin/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set('Cookie', cookie);

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).error.message).toContain('92 dias');
  });

  it('GET /appointments com intervalo de exatamente 92 dias e aceito (teto e inclusive)', async () => {
    const cookie = await loginAs('ADMIN');
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 92 * 24 * 60 * 60 * 1000).toISOString();

    const response = await request(app.getHttpServer())
      .get(`/api/admin/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set('Cookie', cookie);

    expect(response.status).toBe(200);
  });

  it('GET /availability com from/to invertidos tambem responde 400 (mesmo buraco, mesmo controller)', async () => {
    const cookie = await loginAs('ADMIN');
    const from = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now()).toISOString();

    const response = await request(app.getHttpServer())
      .get(
        `/api/admin/availability?professionalId=${professionalAId}&procedureId=${procedureId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )
      .set('Cookie', cookie);

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).error.message).toContain('não pode ser anterior');
  });

  it('GET /availability com intervalo acima de 92 dias tambem responde 400', async () => {
    const cookie = await loginAs('ADMIN');
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000).toISOString();

    const response = await request(app.getHttpServer())
      .get(
        `/api/admin/availability?professionalId=${professionalAId}&procedureId=${procedureId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )
      .set('Cookie', cookie);

    expect(response.status).toBe(400);
    expect((response.body as ErrorBody).error.message).toContain('92 dias');
  });
});

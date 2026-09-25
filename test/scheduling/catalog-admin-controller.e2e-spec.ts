import 'reflect-metadata';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { AppointmentStatus } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { clearLoginRateLimit } from '../support/clear-login-rate-limit';
import { configureTestApp } from '../support/configure-test-app';
import { uniquePhone } from '../support/unique-phone';
import { waitForQueueWorkersReady } from '../support/wait-for-queues-ready';
import { alignedFutureSlot } from './support/seed-scheduling-fixtures';

/**
 * Principio do usuario (revisao da Etapa 3): "catalogo define o futuro,
 * nao reescreve o passado." Os tres testes centrais deste arquivo provam
 * exatamente os tres casos que ele descreveu — nao so que o CRUD funciona.
 */
describe('CatalogAdminController — os 3 casos de impacto em consulta ja marcada (e2e)', () => {
  let app: INestApplication<Server>;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let adminCookie: string;

  let clinicId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureTestApp(app);
    prisma = moduleRef.get(PrismaService);
    await app.init();
    await waitForQueueWorkersReady(moduleRef);

    const clinic = await prisma.clinic.create({
      data: { name: `Clinica Catalog Teste ${uniquePhone()}`, timezone: 'America/Fortaleza', addressLine: 'Rua Teste', phone: `+${uniquePhone()}` },
    });
    clinicId = clinic.id;
  });

  // Shutdown do app medido entre 80ms e ~9.5s em rodadas normais, mas
  // ocasionalmente passa de 30s sob carga real da maquina — por isso o
  // hookTimeout GLOBAL subiu pra 90000 em vitest.config.ts (apareceu em 3
  // arquivos e2e diferentes, nao e especifico deste). As asserções em si
  // sao 100% deterministicas e passam sempre; so o teardown varia.
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await clearLoginRateLimit(moduleRef);
    const email = `admin-catalog-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Admin Catalog', role: 'ADMIN' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    adminCookie = loginResponse.headers['set-cookie'][0];
  });

  /**
   * Caso 1 (profissional): desativar com consulta futura confirmada NAO
   * apaga nem cancela a consulta, so avisa — e passa a impedir novo
   * agendamento pro mesmo profissional dali em diante.
   */
  it('Caso 1 — desativar profissional com consulta futura confirmada: avisa, mantem a consulta, bloqueia novo agendamento', async () => {
    const professional = await prisma.professional.create({
      data: { clinicId, name: `Profissional Caso1 ${uniquePhone()}`, specialty: 'Teste' },
    });
    const procedure = await prisma.procedure.create({
      data: { clinicId, name: `Procedimento Caso1 ${uniquePhone()}`, durationMin: 30 },
    });
    await prisma.availabilityRule.create({
      data: { professionalId: professional.id, weekday: new Date().getDay(), startTime: '00:00', endTime: '23:30', slotMinutes: 30 },
    });
    const patient = await prisma.patient.create({ data: { phoneE164: `+${uniquePhone()}` } });

    const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const appointment = await prisma.appointment.create({
      data: { professionalId: professional.id, patientId: patient.id, procedureId: procedure.id, startsAt, endsAt, status: AppointmentStatus.CONFIRMED },
    });

    const response = await request(app.getHttpServer())
      .put(`/api/admin/catalog/professionals/${professional.id}`)
      .set('Cookie', adminCookie)
      .send({ active: false });

    expect(response.status).toBe(200);
    expect(response.body.professional.active).toBe(false);
    expect(response.body.affectedAppointments.map((a: { id: string }) => a.id)).toContain(appointment.id);

    // A consulta continua CONFIRMED, intocada.
    const stillConfirmed = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(stillConfirmed.status).toBe(AppointmentStatus.CONFIRMED);
    expect(stillConfirmed.startsAt).toEqual(startsAt);

    // Novo agendamento pro mesmo profissional agora falha — RN-06 estendida
    // pelo achado desta etapa (professional/procedure inativo bloqueia).
    const newSlot = alignedFutureSlot(new Date(), 5 * 24);
    const createResponse = await request(app.getHttpServer())
      .post('/api/admin/appointments')
      .set('Cookie', adminCookie)
      .send({ patientId: patient.id, professionalId: professional.id, procedureId: procedure.id, startsAt: newSlot.toISOString() });

    expect(createResponse.status).toBe(400);
  });

  /**
   * Caso 2 (procedimento): mudar durationMin nunca reescreve o
   * startsAt/endsAt de consulta ja marcada — regressao explicita.
   */
  it('Caso 2 — mudar durationMin do procedimento NAO altera consulta ja marcada (endsAt continua o original)', async () => {
    const professional = await prisma.professional.create({
      data: { clinicId, name: `Profissional Caso2 ${uniquePhone()}`, specialty: 'Teste' },
    });
    const procedure = await prisma.procedure.create({
      data: { clinicId, name: `Procedimento Caso2 ${uniquePhone()}`, durationMin: 30 },
    });
    const patient = await prisma.patient.create({ data: { phoneE164: `+${uniquePhone()}` } });

    const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const originalEndsAt = new Date(startsAt.getTime() + 30 * 60 * 1000); // 30min, duration original
    const appointment = await prisma.appointment.create({
      data: { professionalId: professional.id, patientId: patient.id, procedureId: procedure.id, startsAt, endsAt: originalEndsAt, status: AppointmentStatus.CONFIRMED },
    });

    const response = await request(app.getHttpServer())
      .put(`/api/admin/catalog/procedures/${procedure.id}`)
      .set('Cookie', adminCookie)
      .send({ durationMin: 90 });

    expect(response.status).toBe(200);
    expect(response.body.procedure.durationMin).toBe(90);

    // A consulta ja marcada continua com o endsAt ORIGINAL — nunca
    // recalculado a partir do durationMin novo do procedimento.
    const unchanged = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(unchanged.startsAt).toEqual(startsAt);
    expect(unchanged.endsAt).toEqual(originalEndsAt);
  });

  /**
   * Caso 3 (regra de disponibilidade): encolher a janela com consulta
   * confirmada fora dela nao move nem cancela a consulta, so avisa.
   */
  it('Caso 3 — encolher janela de disponibilidade com consulta confirmada fora dela: avisa, mantem a consulta', async () => {
    const professional = await prisma.professional.create({
      data: { clinicId, name: `Profissional Caso3 ${uniquePhone()}`, specialty: 'Teste' },
    });
    const procedure = await prisma.procedure.create({
      data: { clinicId, name: `Procedimento Caso3 ${uniquePhone()}`, durationMin: 30 },
    });
    const patient = await prisma.patient.create({ data: { phoneE164: `+${uniquePhone()}` } });

    // Regra original 8h-18h local (America/Fortaleza, UTC-3) num dia da
    // semana fixo (proxima terca-feira, pra nao depender de que dia e hoje).
    const now = new Date();
    const daysUntilNextTuesday = ((2 - now.getUTCDay() + 7) % 7) || 7;
    const nextTuesday = new Date(now.getTime() + (daysUntilNextTuesday + 7) * 24 * 60 * 60 * 1000); // +7 extra pra garantir futuro confortavel
    const weekday = nextTuesday.getUTCDay();

    const rule = await prisma.availabilityRule.create({
      data: { professionalId: professional.id, weekday, startTime: '08:00', endTime: '18:00', slotMinutes: 30 },
    });

    // Consulta confirmada as 15h local (18h UTC, America/Fortaleza) nesse dia.
    const startsAt = new Date(
      Date.UTC(nextTuesday.getUTCFullYear(), nextTuesday.getUTCMonth(), nextTuesday.getUTCDate(), 18, 0, 0),
    );
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const appointment = await prisma.appointment.create({
      data: { professionalId: professional.id, patientId: patient.id, procedureId: procedure.id, startsAt, endsAt, status: AppointmentStatus.CONFIRMED },
    });

    // Encolhe pra 8h-12h local — a consulta das 15h fica fora.
    const response = await request(app.getHttpServer())
      .put(`/api/admin/catalog/availability/rules/${rule.id}`)
      .set('Cookie', adminCookie)
      .send({ endTime: '12:00' });

    expect(response.status).toBe(200);
    expect(response.body.rule.endTime).toBe('12:00');
    expect(response.body.affectedAppointments.map((a: { id: string }) => a.id)).toContain(appointment.id);

    // A consulta continua CONFIRMED, no horario original — nunca movida.
    const stillConfirmed = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(stillConfirmed.status).toBe(AppointmentStatus.CONFIRMED);
    expect(stillConfirmed.startsAt).toEqual(startsAt);
  });

  it('papel RECEPCAO recebe 403 tentando mexer no catalogo (rota restrita a ADMIN)', async () => {
    const email = `recepcao-catalog-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Recepcao Catalog', role: 'RECEPCAO' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    const cookie = loginResponse.headers['set-cookie'][0];

    const response = await request(app.getHttpServer())
      .post('/api/admin/catalog/professionals')
      .set('Cookie', cookie)
      .send({ clinicId, name: 'Tentativa', specialty: 'Teste' });

    expect(response.status).toBe(403);
  });

  /**
   * Achado do usuario (2026-09-25): sem GET aberto, RECEPCAO nao consegue
   * filtrar nem criar consulta manual — bug de RBAC, nao conveniencia.
   * availability/rules e availability/exceptions CONTINUAM ADMIN-only
   * (decisao explicita: e configuracao da clinica, nao leitura de agenda).
   */
  it('papel RECEPCAO le professionals/procedures (200), mas nao availability/rules nem availability/exceptions (403)', async () => {
    const email = `recepcao-leitura-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Recepcao Leitura', role: 'RECEPCAO' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    const cookie = loginResponse.headers['set-cookie'][0];

    const professional = await prisma.professional.create({ data: { clinicId, name: 'Prof RBAC', specialty: 'Teste' } });

    const professionals = await request(app.getHttpServer()).get('/api/admin/catalog/professionals').set('Cookie', cookie);
    expect(professionals.status).toBe(200);

    const procedures = await request(app.getHttpServer()).get('/api/admin/catalog/procedures').set('Cookie', cookie);
    expect(procedures.status).toBe(200);

    const rules = await request(app.getHttpServer())
      .get(`/api/admin/catalog/availability/rules?professionalId=${professional.id}`)
      .set('Cookie', cookie);
    expect(rules.status).toBe(403);

    const exceptions = await request(app.getHttpServer())
      .get(`/api/admin/catalog/availability/exceptions?professionalId=${professional.id}&from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z`)
      .set('Cookie', cookie);
    expect(exceptions.status).toBe(403);
  });

  it('papel PROFISSIONAL tambem le professionals/procedures (200) — GET nao restringe por papel especifico', async () => {
    const email = `profissional-leitura-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    const professional = await prisma.professional.create({ data: { clinicId, name: 'Prof Leitura', specialty: 'Teste' } });
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Profissional Leitura', role: 'PROFISSIONAL', professionalId: professional.id },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    const cookie = loginResponse.headers['set-cookie'][0];

    const response = await request(app.getHttpServer()).get('/api/admin/catalog/professionals').set('Cookie', cookie);
    expect(response.status).toBe(200);
  });
});

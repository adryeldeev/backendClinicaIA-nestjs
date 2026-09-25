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

/**
 * GET /api/admin/patients/:id/appointments (achado do usuario, 2026-09-25)
 * — servido por scheduling (dono de Appointment), URL comeca em /patients
 * (dono e conversation). Prova que o roteamento entre modulos funciona de
 * verdade, nao so que compila.
 */
describe('PatientAppointmentsAdminController — historico futuro/passado (e2e)', () => {
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
    const email = `admin-patient-appts-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Admin Historico', role: 'ADMIN' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    adminCookie = loginResponse.headers['set-cookie'][0];
  });

  it('separa consultas futuras e passadas, de QUALQUER status (nao so CONFIRMED)', async () => {
    const suffix = uniquePhone();
    const clinic = await prisma.clinic.create({
      data: { name: `Clinica Historico ${suffix}`, timezone: 'America/Fortaleza', addressLine: 'x', phone: `+${suffix}` },
    });
    const professional = await prisma.professional.create({ data: { clinicId: clinic.id, name: 'Prof Historico', specialty: 'Teste' } });
    const procedure = await prisma.procedure.create({ data: { clinicId: clinic.id, name: 'Proc Historico', durationMin: 30 } });
    const patient = await prisma.patient.create({ data: { phoneE164: `+5585${suffix.slice(-9)}` } });

    const future1 = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    // Horario diferente do primeiro — mesmo profissional, mesmo instante
    // colidiria com a constraint EXCLUDE (appointment_no_overlap), que
    // nao sabe que "sao dois testes diferentes", so que se sobrepoem.
    const future2 = new Date(future1.getTime() + 2 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    await prisma.appointment.create({
      data: { professionalId: professional.id, patientId: patient.id, procedureId: procedure.id, startsAt: future1, endsAt: new Date(future1.getTime() + 1800000), status: AppointmentStatus.CONFIRMED },
    });
    await prisma.appointment.create({
      data: { professionalId: professional.id, patientId: patient.id, procedureId: procedure.id, startsAt: future2, endsAt: new Date(future2.getTime() + 1800000), status: AppointmentStatus.HELD, holdExpiresAt: new Date(Date.now() + 600000) },
    });
    await prisma.appointment.create({
      data: { professionalId: professional.id, patientId: patient.id, procedureId: procedure.id, startsAt: past, endsAt: new Date(past.getTime() + 1800000), status: AppointmentStatus.CANCELLED, cancelReason: 'teste' },
    });

    const response = await request(app.getHttpServer())
      .get(`/api/admin/patients/${patient.id}/appointments`)
      .set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    const body = response.body as { upcoming: Array<{ status: string }>; past: Array<{ status: string }> };
    expect(body.upcoming).toHaveLength(2); // CONFIRMED + HELD, ambos futuros
    expect(body.past).toHaveLength(1); // CANCELLED, passado
    expect(body.past[0].status).toBe('CANCELLED');
  });

  it('id de paciente inexistente devolve listas vazias, nunca 404 ou 500 (scheduling nao e dono de Patient)', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/admin/patients/00000000-0000-0000-0000-000000000000/appointments')
      .set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ upcoming: [], past: [] });
  });

  it('sem sessao responde 401', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/admin/patients/00000000-0000-0000-0000-000000000000/appointments',
    );
    expect(response.status).toBe(401);
  });
});

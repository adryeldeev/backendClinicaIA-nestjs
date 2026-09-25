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

type PatientBody = { id: string; name: string | null; phoneE164: string };
type ErrorBody = { error: { code: string; details?: { existingPatientId: string } } };

/**
 * POST /api/admin/patients e GET /api/admin/patients/:id (achado do
 * usuario, 2026-09-25) — cadastro manual pela recepcao: quem chega sem
 * nunca ter mandado WhatsApp.
 */
describe('PatientsAdminController — cadastro manual e detalhe (e2e)', () => {
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
    const email = `admin-patients-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Admin Pacientes', role: 'ADMIN' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    adminCookie = loginResponse.headers['set-cookie'][0];
  });

  it('cadastra paciente com nome e telefone com pontuacao — normaliza pra E.164 no servidor', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/admin/patients')
      .set('Cookie', adminCookie)
      .send({ name: 'Paciente Balcao', phoneE164: `(85) 9${uniquePhone().slice(-8)}` });

    expect(response.status).toBe(201);
    const body = response.body as PatientBody;
    expect(body.phoneE164).toMatch(/^\+55\d{10,11}$/);
    expect(body.name).toBe('Paciente Balcao');
  });

  it('cadastra com birthDate/insuranceId opcionais ausentes — nao quebra', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/admin/patients')
      .set('Cookie', adminCookie)
      .send({ name: 'Paciente Sem Convenio', phoneE164: `85 9${uniquePhone().slice(-8)}` });

    expect(response.status).toBe(201);
  });

  it('telefone em formato invalido responde 400, nao aceita silenciosamente', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/admin/patients')
      .set('Cookie', adminCookie)
      .send({ name: 'Paciente Invalido', phoneE164: '123' });

    expect(response.status).toBe(400);
  });

  /**
   * Achado do usuario: "o caso mais comum do balcao — a pessoa ja
   * conversou pelo WhatsApp e ja tem cadastro." 409 com o id do paciente
   * existente, pra tela oferecer "abrir cadastro" em vez de so "falhou".
   */
  it('telefone duplicado responde 409 com o id do paciente ja existente em details', async () => {
    const phone = `+5585${uniquePhone().slice(-9)}`;
    const existing = await prisma.patient.create({ data: { phoneE164: phone, name: 'Ja Cadastrado' } });

    const response = await request(app.getHttpServer())
      .post('/api/admin/patients')
      .set('Cookie', adminCookie)
      .send({ name: 'Tentativa Duplicada', phoneE164: phone });

    expect(response.status).toBe(409);
    const body = response.body as ErrorBody;
    expect(body.error.code).toBe('PATIENT_PHONE_ALREADY_REGISTERED');
    expect(body.error.details?.existingPatientId).toBe(existing.id);
  });

  it('GET /patients/:id devolve o detalhe do paciente', async () => {
    const patient = await prisma.patient.create({ data: { phoneE164: `+55${uniquePhone()}`, name: 'Paciente Detalhe' } });

    const response = await request(app.getHttpServer()).get(`/api/admin/patients/${patient.id}`).set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    const body = response.body as PatientBody;
    expect(body.id).toBe(patient.id);
    expect(body.name).toBe('Paciente Detalhe');
  });

  it('GET /patients/:id com id inexistente responde 404, nunca 500', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/admin/patients/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie);

    expect(response.status).toBe(404);
    expect((response.body as ErrorBody).error.code).toBe('PATIENT_NOT_FOUND');
  });

  it('PROFISSIONAL recebe 403 tentando cadastrar paciente (RBAC restrito a ADMIN/RECEPCAO)', async () => {
    const professional = await prisma.professional.create({
      data: {
        clinicId: (await prisma.clinic.create({ data: { name: `Clinica Teste ${uniquePhone()}`, timezone: 'America/Fortaleza', addressLine: 'x', phone: `+${uniquePhone()}` } })).id,
        name: 'Prof Teste',
        specialty: 'Teste',
      },
    });
    const email = `profissional-patients-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Profissional Teste', role: 'PROFISSIONAL', professionalId: professional.id },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    const cookie = loginResponse.headers['set-cookie'][0];

    const response = await request(app.getHttpServer())
      .post('/api/admin/patients')
      .set('Cookie', cookie)
      .send({ name: 'Tentativa', phoneE164: `85 9${uniquePhone().slice(-8)}` });

    expect(response.status).toBe(403);
  });
});

import 'reflect-metadata';
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

const NONEXISTENT_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Achado do usuario (regressao de 2026-09-24): o AllExceptionsFilter pegou
 * um problema real, nao so provou a rede de seguranca — violacao de FK
 * (P2003) chegando la e virando 500 generico e um erro de CLIENTE (dado
 * invalido no corpo), nao interno. Classe inteira de rotas tinha o mesmo
 * buraco (qualquer create/update com FK vinda do corpo). Correcao central,
 * na PrismaService (map-prisma-error.ts) — este teste prova o mecanismo
 * de verdade, via rota real, nao a funcao isolada.
 */
describe('Traducao de erro do Prisma pra erro de dominio (e2e, achado do usuario 2026-09-24)', () => {
  let app: INestApplication;
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
    await clearLoginRateLimit(moduleRef);

    const email = `admin-prisma-error-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Admin Prisma Error', role: 'ADMIN' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    adminCookie = loginResponse.headers['set-cookie'][0];
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await clearLoginRateLimit(moduleRef);
  });

  it('P2003 (FK): POST /catalog/professionals com clinicId inexistente responde 400 REFERENCED_ENTITY_NOT_FOUND, nunca 500', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/admin/catalog/professionals')
      .set('Cookie', adminCookie)
      .send({ clinicId: NONEXISTENT_UUID, name: 'Teste FK', specialty: 'Teste' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('REFERENCED_ENTITY_NOT_FOUND');
    // SEC-02: nunca vaza nome de constraint/coluna/tabela na mensagem pro cliente.
    expect(response.body.error.message).not.toContain('Professional');
    expect(response.body.error.message).not.toContain('clinicId');
    expect(response.body.error.message).not.toContain('fkey');
  });

  /**
   * Achado do usuario (2026-09-24): tipo sozinho nao basta pra quem
   * captura este erro por logica propria — precisa saber QUAL FK falhou.
   * Prova o mecanismo de extracao (`extractFkField`) contra o Postgres
   * real, nao so contra um objeto de meta fabricado a mao.
   */
  it('P2003 (FK): carrega o campo da FK que falhou em error.field, extraido do meta real do Postgres', async () => {
    await expect(
      prisma.professional.create({
        data: { clinicId: NONEXISTENT_UUID, name: 'Teste FK field', specialty: 'Teste' },
      }),
    ).rejects.toMatchObject({ code: 'REFERENCED_ENTITY_NOT_FOUND', field: 'clinicId' });
  });

  // patientId de /appointments nao passa por checagem previa de existencia
  // (professionalId ja e coberto indiretamente — sem regra de disponibilidade
  // pro id, ListAvailableSlotsUseCase nunca gera candidato, 404 antes de
  // qualquer INSERT) — patientId e o FK genuinamente desprotegido desta rota.
  it('P2003 (FK): POST /appointments com patientId inexistente tambem traduz (a mesma classe, outro campo)', async () => {
    const clinic = await prisma.clinic.create({
      data: { name: `Clinica FK Teste ${uniquePhone()}`, timezone: 'America/Fortaleza', addressLine: 'x', phone: `+${uniquePhone()}` },
    });
    const professional = await prisma.professional.create({ data: { clinicId: clinic.id, name: 'Prof FK Teste', specialty: 'Geral' } });
    const procedure = await prisma.procedure.create({ data: { clinicId: clinic.id, name: 'Proc Teste', durationMin: 30 } });
    const startsAt = new Date();
    startsAt.setUTCDate(startsAt.getUTCDate() + 5);
    startsAt.setUTCHours(14, 0, 0, 0);
    await prisma.availabilityRule.create({
      data: { professionalId: professional.id, weekday: startsAt.getUTCDay(), startTime: '00:00', endTime: '23:30', slotMinutes: 30 },
    });

    const response = await request(app.getHttpServer())
      .post('/api/admin/appointments')
      .set('Cookie', adminCookie)
      .send({
        patientId: NONEXISTENT_UUID,
        professionalId: professional.id,
        procedureId: procedure.id,
        startsAt: startsAt.toISOString(),
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('REFERENCED_ENTITY_NOT_FOUND');
  });

  it('P2002 (unique): criar dois usuarios com o mesmo email responde 409 DUPLICATE_ENTRY, nunca 500', async () => {
    const email = `duplicado-${uniquePhone()}@clinica.test`;
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash('senha-forte-123'), name: 'Original', role: 'ADMIN' },
    });

    // Bate direto no repositorio via um caminho que nao pre-checa (create-first-admin
    // ja recusa se existe ADMIN, entao a violacao teria que vir de outro lugar —
    // aqui provamos o MECANISMO direto no PrismaService, nao uma rota especifica).
    await expect(
      prisma.user.create({
        data: { email, passwordHash: 'x', name: 'Duplicado', role: 'RECEPCAO' },
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ENTRY', httpStatus: 409, fields: ['email'] });
  });

  it('P2025 (registro nao encontrado): update direto num id inexistente traduz pra 404 RECORD_NOT_FOUND', async () => {
    await expect(
      prisma.professional.update({ where: { id: NONEXISTENT_UUID }, data: { active: false } }),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND', httpStatus: 404 });
  });

  /**
   * Achado do usuario (2026-09-24, 2a rodada): a traducao central so
   * cobria PrismaClientKnownRequestError (P20xx) — 23P01 (exclusion
   * violation, PrismaClientUnknownRequestError) chegava cru em qualquer
   * lugar que nao fosse o unico call site que ja sabia procurar por ela.
   * Prova o mecanismo de extracao (`extractExclusionConstraint`) contra o
   * Postgres real, nao um objeto fabricado a mao — mesmo INSERT duplo que
   * `test/scheduling/concurrency.e2e-spec.ts` ja usa, mas direto no
   * PrismaService, sem passar pelo isSlotConflict/SlotTakenError.
   */
  it('23P01 (EXCLUDE): dois agendamentos sobrepostos no mesmo profissional traduzem pra 409 EXCLUSION_VIOLATION com o nome real da constraint', async () => {
    const clinic = await prisma.clinic.create({
      data: { name: `Clinica EXCLUDE Teste ${uniquePhone()}`, timezone: 'America/Fortaleza', addressLine: 'x', phone: `+${uniquePhone()}` },
    });
    const professional = await prisma.professional.create({ data: { clinicId: clinic.id, name: 'Prof EXCLUDE Teste', specialty: 'Geral' } });
    const procedure = await prisma.procedure.create({ data: { clinicId: clinic.id, name: 'Proc EXCLUDE Teste', durationMin: 30 } });
    const patientA = await prisma.patient.create({ data: { phoneE164: `+${uniquePhone()}` } });
    const patientB = await prisma.patient.create({ data: { phoneE164: `+${uniquePhone()}` } });
    const startsAt = new Date();
    startsAt.setUTCDate(startsAt.getUTCDate() + 6);
    startsAt.setUTCHours(15, 0, 0, 0);
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);

    await prisma.appointment.create({
      data: { professionalId: professional.id, patientId: patientA.id, procedureId: procedure.id, startsAt, endsAt, status: 'HELD', createdBy: 'agent' },
    });

    await expect(
      prisma.appointment.create({
        data: { professionalId: professional.id, patientId: patientB.id, procedureId: procedure.id, startsAt, endsAt, status: 'HELD', createdBy: 'agent' },
      }),
    ).rejects.toMatchObject({ code: 'EXCLUSION_VIOLATION', httpStatus: 409, constraint: 'appointment_no_overlap' });
  });
});

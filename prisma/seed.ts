import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

// weekday: 0 = domingo ... 6 = sabado
const WEEKDAYS_SEG_A_SEX = [1, 2, 3, 4, 5];

// Credencial de DEV pro painel (clinica-web) conseguir testar login e a
// casca autenticada sem precisar rodar `npm run create-admin` a parte —
// achado do usuario: a Fase 0 do front estava parada nesse ponto. De
// proposito FORA do .env.example/.env — nao e segredo de producao, e
// senha fixa e conhecida de um seed de desenvolvimento local, nunca deve
// existir num ambiente com RETENTION_PURGE_ENABLED=true ou dado real.
const DEV_ADMIN_EMAIL = 'admin@clinica.dev';
const DEV_ADMIN_PASSWORD = 'dev-admin-senha-123';
// Achado do usuario: sem RECEPCAO/PROFISSIONAL no seed, o front (clinica-web)
// nao consegue testar navegacao por papel nem o filtro de agenda por
// professionalId (criterio de aceite #14) so com ADMIN — bloqueava a Fase 1
// deles. Mesma ressalva do admin acima: senha fixa, fora do .env.example.
const DEV_RECEPCAO_EMAIL = 'recepcao@clinica.dev';
const DEV_RECEPCAO_PASSWORD = 'dev-recepcao-senha-123';
const DEV_PROFISSIONAL_EMAIL = 'profissional@clinica.dev';
const DEV_PROFISSIONAL_PASSWORD = 'dev-profissional-senha-123';

/**
 * Extraido de main() pra ser reaproveitado pelo global setup do vitest
 * (test/support/global-setup.ts) — mesma massa de dados de base, sem
 * duplicar a definicao. CLI (`npm run prisma:seed`) continua chamando via
 * main() abaixo.
 */
export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  const clinic = await prisma.clinic.create({
    data: {
      name: 'Clinica Bem Estar',
      timezone: 'America/Fortaleza',
      addressLine: 'Av. Santos Dumont, 1500, Fortaleza - CE',
      phone: '+5585999990000',
    },
  });

  const drAna = await prisma.professional.create({
    data: {
      clinicId: clinic.id,
      name: 'Dra. Ana Souza',
      specialty: 'Clinica Geral',
      councilNumber: 'CRM-CE 12345',
    },
  });

  const drCarlos = await prisma.professional.create({
    data: {
      clinicId: clinic.id,
      name: 'Dr. Carlos Lima',
      specialty: 'Cardiologia',
      councilNumber: 'CRM-CE 54321',
    },
  });

  const consultaGeral = await prisma.procedure.create({
    data: {
      clinicId: clinic.id,
      name: 'Consulta Clinica Geral',
      durationMin: 30,
      priceCents: 15000,
    },
  });

  const consultaCardio = await prisma.procedure.create({
    data: {
      clinicId: clinic.id,
      name: 'Consulta Cardiologica',
      durationMin: 40,
      priceCents: 25000,
    },
  });

  const retornoCardio = await prisma.procedure.create({
    data: {
      clinicId: clinic.id,
      name: 'Retorno Cardiologico',
      durationMin: 20,
      priceCents: 0,
      requiresReturn: true,
    },
  });

  const eletrocardiograma = await prisma.procedure.create({
    data: {
      clinicId: clinic.id,
      name: 'Eletrocardiograma',
      durationMin: 20,
      priceCents: 12000,
    },
  });

  await prisma.procedureOnProfessional.createMany({
    data: [
      { procedureId: consultaGeral.id, professionalId: drAna.id },
      { procedureId: consultaCardio.id, professionalId: drCarlos.id },
      { procedureId: retornoCardio.id, professionalId: drCarlos.id },
      { procedureId: eletrocardiograma.id, professionalId: drCarlos.id },
    ],
  });

  const availabilityRules = [
    ...WEEKDAYS_SEG_A_SEX.map((weekday) => ({
      professionalId: drAna.id,
      weekday,
      startTime: '08:00',
      endTime: '12:00',
      slotMinutes: 30,
    })),
    ...WEEKDAYS_SEG_A_SEX.map((weekday) => ({
      professionalId: drCarlos.id,
      weekday,
      startTime: '14:00',
      endTime: '18:00',
      slotMinutes: 40,
    })),
  ];

  await prisma.availabilityRule.createMany({ data: availabilityRules });

  const admin = await prisma.user.create({
    data: {
      email: DEV_ADMIN_EMAIL,
      passwordHash: await argon2.hash(DEV_ADMIN_PASSWORD),
      name: 'Admin Dev',
      role: 'ADMIN',
    },
  });

  const recepcao = await prisma.user.create({
    data: {
      email: DEV_RECEPCAO_EMAIL,
      passwordHash: await argon2.hash(DEV_RECEPCAO_PASSWORD),
      name: 'Recepcao Dev',
      role: 'RECEPCAO',
    },
  });

  // professionalId aponta pra Dra. Ana — permite testar de verdade o filtro
  // de agenda restrito ao proprio profissional (resolveAppointmentScope).
  const profissional = await prisma.user.create({
    data: {
      email: DEV_PROFISSIONAL_EMAIL,
      passwordHash: await argon2.hash(DEV_PROFISSIONAL_PASSWORD),
      name: 'Dra. Ana Souza (login)',
      role: 'PROFISSIONAL',
      professionalId: drAna.id,
    },
  });

  console.log('Seed concluido:', {
    clinic: clinic.name,
    professionals: [drAna.name, drCarlos.name],
    procedures: [consultaGeral.name, consultaCardio.name, retornoCardio.name, eletrocardiograma.name],
    availabilityRules: availabilityRules.length,
    adminDev: { email: admin.email, senha: DEV_ADMIN_PASSWORD },
    recepcaoDev: { email: recepcao.email, senha: DEV_RECEPCAO_PASSWORD },
    profissionalDev: { email: profissional.email, senha: DEV_PROFISSIONAL_PASSWORD, professionalId: drAna.id },
  });
}


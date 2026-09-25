import { PrismaService } from '../../../src/shared/database/prisma.service';
import { uniquePhone } from '../../support/unique-phone';

export interface SchedulingFixtures {
  clinicId: string;
  professionalId: string;
  procedureId: string;
  /** Mesmo profissional, procedimento de 60min — usado nos testes de sobreposicao (durationMin variavel). */
  procedureLongId: string;
  patientAId: string;
  patientBId: string;
}

const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * "Agora" fixo compartilhado pelos testes de agendamento — 09:00 em
 * America/Fortaleza (12:00 UTC), meio da manha, longe de qualquer borda
 * de grid (00:00/23:30) mesmo somando os maiores offsets usados na suite
 * (ate 70 dias). Ver FixedClock em test/support/fixed-clock.ts.
 */
export const FIXED_NOW = new Date('2026-01-15T12:00:00.000Z');

/**
 * Regra de disponibilidade cobrindo o dia inteiro (00:00-23:30, passo de
 * 30min) em todos os dias da semana — assim os testes nao precisam se
 * preocupar com em qual dia da semana rodam, so com RN-04/05 (antecedencia).
 */
export async function seedSchedulingFixtures(prisma: PrismaService): Promise<SchedulingFixtures> {
  const suffix = uniquePhone();

  const clinic = await prisma.clinic.create({
    data: {
      name: `Clinica Teste ${suffix}`,
      timezone: 'America/Fortaleza',
      addressLine: 'Rua de Teste, 1',
      phone: `+${suffix}`,
    },
  });

  const professional = await prisma.professional.create({
    data: { clinicId: clinic.id, name: `Profissional Teste ${suffix}`, specialty: 'Teste' },
  });

  const procedure = await prisma.procedure.create({
    data: { clinicId: clinic.id, name: `Procedimento Teste ${suffix}`, durationMin: 30 },
  });

  const procedureLong = await prisma.procedure.create({
    data: { clinicId: clinic.id, name: `Procedimento Longo Teste ${suffix}`, durationMin: 60 },
  });

  await prisma.availabilityRule.createMany({
    data: ALL_WEEKDAYS.map((weekday) => ({
      professionalId: professional.id,
      weekday,
      startTime: '00:00',
      endTime: '23:30',
      slotMinutes: 30,
    })),
  });

  const patientA = await prisma.patient.create({ data: { phoneE164: `+${uniquePhone()}` } });
  const patientB = await prisma.patient.create({ data: { phoneE164: `+${uniquePhone()}` } });

  return {
    clinicId: clinic.id,
    professionalId: professional.id,
    procedureId: procedure.id,
    procedureLongId: procedureLong.id,
    patientAId: patientA.id,
    patientBId: patientB.id,
  };
}

const THIRTY_MIN_MS = 30 * 60 * 1000;

/**
 * Horario alinhado a grade de 30min, `hoursFromNow` a frente de `now`.
 * `now` e sempre explicito (nunca lido do relogio real) — quem chama
 * passa o mesmo instante que configurou no FixedClock do teste, pra que
 * "quando alignedFutureSlot calcula o slot" e "quando a regra de negocio
 * calcula o agora" nunca divirjam (achado na Fase 2: um horario que cai
 * exatamente na borda de fechamento do grid so aparece se os dois lerem
 * o relogio em momentos ligeiramente diferentes).
 */
export function alignedFutureSlot(now: Date, hoursFromNow: number): Date {
  const target = now.getTime() + hoursFromNow * 60 * 60 * 1000;
  return new Date(Math.ceil(target / THIRTY_MIN_MS) * THIRTY_MIN_MS);
}

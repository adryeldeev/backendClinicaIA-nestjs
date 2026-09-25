import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { seedTestAppointments } from '../prisma/seed-appointments';

const FIXTURE_PHONE_PREFIX = '+558598000000';
const BLOCKED_DAY_REASON = 'Fixture — bloqueio de agenda (ex.: ferias, congresso)';

/**
 * Mesma ideia de test/seed-conversations.spec.ts (achado do usuario:
 * economizou dias de autorizacao conversa a conversa la, mesmo problema
 * aqui pra agenda). Prova idempotencia (rodar 2x nao duplica), isolamento
 * (nunca mexe fora do proprio prefixo/marcador) e os 7 estados nomeados.
 */
describe('seedTestAppointments — idempotencia', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rodar duas vezes nao duplica — sempre exatamente 6 consultas fixture + 1 bloqueio', async () => {
    await seedTestAppointments(prisma);
    const afterFirst = await prisma.patient.count({ where: { phoneE164: { startsWith: FIXTURE_PHONE_PREFIX } } });
    const exceptionsFirst = await prisma.availabilityException.count({ where: { reason: BLOCKED_DAY_REASON } });
    expect(afterFirst).toBe(6);
    expect(exceptionsFirst).toBe(1);

    await seedTestAppointments(prisma);
    const afterSecond = await prisma.patient.count({ where: { phoneE164: { startsWith: FIXTURE_PHONE_PREFIX } } });
    const exceptionsSecond = await prisma.availabilityException.count({ where: { reason: BLOCKED_DAY_REASON } });
    expect(afterSecond).toBe(6);
    expect(exceptionsSecond).toBe(1);
  });

  it('nunca mexe em paciente/consulta fora do proprio prefixo, nem em bloqueio de agenda de outro motivo', async () => {
    const outsidePatient = await prisma.patient.create({ data: { phoneE164: `+${Date.now()}` } });
    const professional = await prisma.professional.findFirstOrThrow();
    const outsideException = await prisma.availabilityException.create({
      data: { professionalId: professional.id, startsAt: new Date(), endsAt: new Date(), reason: 'Bloqueio de outro motivo' },
    });

    await seedTestAppointments(prisma);
    await seedTestAppointments(prisma);

    const stillThere = await prisma.patient.findUnique({ where: { id: outsidePatient.id } });
    expect(stillThere).not.toBeNull();
    const exceptionStillThere = await prisma.availabilityException.findUnique({ where: { id: outsideException.id } });
    expect(exceptionStillThere).not.toBeNull();
  });

  it('cria os 6 estados nomeados esperados, mais o bloqueio de agenda', async () => {
    await seedTestAppointments(prisma);
    const patients = await prisma.patient.findMany({
      where: { phoneE164: { startsWith: FIXTURE_PHONE_PREFIX } },
      include: { appointments: true },
    });
    expect(patients).toHaveLength(6);

    const byName = new Map(patients.map((p) => [p.name, p.appointments[0]]));
    const get = (name: string) => byName.get(name)!;

    expect(get('Fixture Confirmada Hoje').status).toBe('CONFIRMED');
    expect(get('Fixture Confirmada Esta Semana').status).toBe('CONFIRMED');

    expect(get('Fixture HELD Dentro do TTL').status).toBe('HELD');
    expect(get('Fixture HELD Dentro do TTL').holdExpiresAt!.getTime()).toBeGreaterThan(Date.now());

    expect(get('Fixture HELD Vencida').status).toBe('HELD');
    expect(get('Fixture HELD Vencida').holdExpiresAt!.getTime()).toBeLessThan(Date.now());

    expect(get('Fixture Cancelada').status).toBe('CANCELLED');
    expect(get('Fixture Cancelada').lateCancellation).toBe(false);

    expect(get('Fixture Cancelamento Tardio').status).toBe('CANCELLED');
    expect(get('Fixture Cancelamento Tardio').lateCancellation).toBe(true);

    // Uma para cada profissional (achado do usuario): as 6 fixtures se
    // dividem entre os dois profissionais do seed base, nao ficam todas
    // no mesmo.
    const professionalIds = new Set(patients.map((p) => p.appointments[0].professionalId));
    expect(professionalIds.size).toBe(2);

    const exception = await prisma.availabilityException.findFirstOrThrow({ where: { reason: BLOCKED_DAY_REASON } });
    expect(exception.blocking).toBe(true);
  });
});

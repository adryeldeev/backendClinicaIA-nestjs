import 'reflect-metadata';
import { TestingModule } from '@nestjs/testing';
import { AppointmentStatus } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HoldSlotUseCase, SlotTakenError } from '../../src/modules/scheduling';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { FixedClock } from '../support/fixed-clock';
import { bootstrapSchedulingTestModule } from './support/bootstrap-scheduling-module';
import {
  alignedFutureSlot,
  FIXED_NOW,
  seedSchedulingFixtures,
  SchedulingFixtures,
} from './support/seed-scheduling-fixtures';

describe('Concorrencia real no HoldSlotUseCase (Fase 2, e2e)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let holdSlot: HoldSlotUseCase;
  let fixtures: SchedulingFixtures;

  beforeAll(async () => {
    moduleRef = await bootstrapSchedulingTestModule(new FixedClock(FIXED_NOW));
    prisma = moduleRef.get(PrismaService);
    holdSlot = moduleRef.get(HoldSlotUseCase);
    fixtures = await seedSchedulingFixtures(prisma);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it(
    'criterio de aceite #2: duas reservas concorrentes no mesmo slot — exatamente uma tem sucesso',
    async () => {
      const contestedSlot = alignedFutureSlot(FIXED_NOW, 15);

      // IMPORTANTE: isto e concorrencia REAL, nao duas chamadas em sequencia.
      // As duas promises sao criadas e disparadas AQUI, sem `await` entre
      // elas — cada `holdSlot.execute` abre sua propria conexao do pool do
      // Prisma e ambas chegam ao Postgres praticamente ao mesmo tempo,
      // competindo de verdade pela constraint de exclusao
      // (appointment_no_overlap). Duas chamadas sequenciais
      // (await a depois await b) sempre passariam e nao provariam nada —
      // esse e o erro mais comum nesse tipo de teste.
      const results = await Promise.allSettled([
        holdSlot.execute({
          professionalId: fixtures.professionalId,
          procedureId: fixtures.procedureId,
          patientId: fixtures.patientAId,
          startsAt: contestedSlot,
          createdBy: 'agent',
        }),
        holdSlot.execute({
          professionalId: fixtures.professionalId,
          procedureId: fixtures.procedureId,
          patientId: fixtures.patientBId,
          startsAt: contestedSlot,
          createdBy: 'agent',
        }),
      ]);

      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof holdSlot.execute>>> =>
          r.status === 'fulfilled',
      );
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(SlotTakenError);

      // Confirma no banco: so um Appointment HELD nesse slot para esse
      // profissional, nao dois.
      const appointmentsAtSlot = await prisma.appointment.findMany({
        where: {
          professionalId: fixtures.professionalId,
          startsAt: contestedSlot,
          status: { in: [AppointmentStatus.HELD, AppointmentStatus.CONFIRMED] },
        },
      });
      expect(appointmentsAtSlot).toHaveLength(1);
      expect(appointmentsAtSlot[0].id).toBe(fulfilled[0].value.appointmentId);
    },
  );

  it(
    'sobreposicao parcial sob concorrencia real (duracoes diferentes, nao o mesmo startsAt) — exatamente uma tem sucesso',
    async () => {
      // Achado da correcao de double-booking: o indice unico antigo so
      // pegava o MESMO startsAt. Uma consulta de 60min as T e uma de
      // 30min as T+30min tem startsAt diferentes mas se sobrepoem de
      // verdade em [T+30, T+60) — e exatamente o caso que a constraint de
      // exclusao (nao mais o indice unico) precisa cobrir. Como as duas
      // requisicoes disparam sem `await` entre si, nenhuma ve a reserva
      // da outra na checagem de bookedIntervals (camada de aplicacao) —
      // quem decide de verdade aqui e a constraint do banco.
      const longSlotStart = alignedFutureSlot(FIXED_NOW, 16);
      const shortSlotStart = new Date(longSlotStart.getTime() + 30 * 60 * 1000);

      const results = await Promise.allSettled([
        holdSlot.execute({
          professionalId: fixtures.professionalId,
          procedureId: fixtures.procedureLongId,
          patientId: fixtures.patientAId,
          startsAt: longSlotStart,
          createdBy: 'agent',
        }),
        holdSlot.execute({
          professionalId: fixtures.professionalId,
          procedureId: fixtures.procedureId,
          patientId: fixtures.patientBId,
          startsAt: shortSlotStart,
          createdBy: 'agent',
        }),
      ]);

      const fulfilled = results.filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof holdSlot.execute>>> =>
          r.status === 'fulfilled',
      );
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(SlotTakenError);

      const appointmentsInWindow = await prisma.appointment.findMany({
        where: {
          professionalId: fixtures.professionalId,
          status: { in: [AppointmentStatus.HELD, AppointmentStatus.CONFIRMED] },
          startsAt: { gte: longSlotStart, lt: new Date(shortSlotStart.getTime() + 30 * 60 * 1000) },
        },
      });
      expect(appointmentsInWindow).toHaveLength(1);
      expect(appointmentsInWindow[0].id).toBe(fulfilled[0].value.appointmentId);
    },
  );
});

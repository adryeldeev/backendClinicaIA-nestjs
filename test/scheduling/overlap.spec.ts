import 'reflect-metadata';
import { TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HoldSlotUseCase, InvalidSlotError, ListOpenSlotsUseCase } from '../../src/modules/scheduling';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { FixedClock } from '../support/fixed-clock';
import { bootstrapSchedulingTestModule } from './support/bootstrap-scheduling-module';
import {
  alignedFutureSlot,
  FIXED_NOW,
  seedSchedulingFixtures,
  SchedulingFixtures,
} from './support/seed-scheduling-fixtures';

/**
 * Correcao de double-booking (pendente desde a Fase 2): o indice unico
 * parcial antigo (professionalId, startsAt) so pegava o MESMO instante de
 * inicio. Com Procedure.durationMin variavel, uma consulta de 60min as
 * 14:00 e uma de 30min as 14:30 tem startsAt diferentes e passavam as
 * duas, mas se sobrepoem de verdade (14:00-15:00 vs 14:30-15:00). A
 * constraint de exclusao (appointment_no_overlap) + o SlotGenerator
 * respeitando durationMin (em vez do grid fixo de AvailabilityRule)
 * fecham essa lacuna. Ver tambem o segundo teste de
 * concurrency.e2e-spec.ts (a mesma sobreposicao, mas sob concorrencia
 * real — quem decide la e a constraint do banco, nao esta checagem de
 * aplicacao).
 */
describe('Sobreposicao de horarios com duracao variavel (correcao de double-booking)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let holdSlot: HoldSlotUseCase;
  let listOpenSlots: ListOpenSlotsUseCase;
  let fixtures: SchedulingFixtures;

  beforeAll(async () => {
    moduleRef = await bootstrapSchedulingTestModule(new FixedClock(FIXED_NOW));
    prisma = moduleRef.get(PrismaService);
    holdSlot = moduleRef.get(HoldSlotUseCase);
    listOpenSlots = moduleRef.get(ListOpenSlotsUseCase);
    fixtures = await seedSchedulingFixtures(prisma);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('sobreposicao parcial (nao so mesmo startsAt) e rejeitada', async () => {
    const longSlotStart = alignedFutureSlot(FIXED_NOW, 30);
    await holdSlot.execute({
      professionalId: fixtures.professionalId,
      procedureId: fixtures.procedureLongId, // 60min
      patientId: fixtures.patientAId,
      startsAt: longSlotStart,
      createdBy: 'agent',
    });

    // Comeca 30min DEPOIS do primeiro (startsAt diferente), mas ainda
    // termina dentro da janela ocupada: [longSlotStart+30, longSlotStart+60)
    // se sobrepoe com [longSlotStart, longSlotStart+60).
    const overlappingStart = new Date(longSlotStart.getTime() + 30 * 60 * 1000);

    await expect(
      holdSlot.execute({
        professionalId: fixtures.professionalId,
        procedureId: fixtures.procedureId, // 30min
        patientId: fixtures.patientBId,
        startsAt: overlappingStart,
        createdBy: 'agent',
      }),
    ).rejects.toThrow(InvalidSlotError);
  });

  it('procedimento de 60min nao e ofertado numa janela de 30min livre', async () => {
    // Duas consultas de 30min com exatamente 30min de folga entre elas:
    // [T, T+30) ocupado, [T+30, T+60) livre, [T+60, T+90) ocupado.
    const firstStart = alignedFutureSlot(FIXED_NOW, 40);
    const gapStart = new Date(firstStart.getTime() + 30 * 60 * 1000);
    const secondStart = new Date(firstStart.getTime() + 60 * 60 * 1000);

    await holdSlot.execute({
      professionalId: fixtures.professionalId,
      procedureId: fixtures.procedureId,
      patientId: fixtures.patientAId,
      startsAt: firstStart,
      createdBy: 'agent',
    });
    await holdSlot.execute({
      professionalId: fixtures.professionalId,
      procedureId: fixtures.procedureId,
      patientId: fixtures.patientBId,
      startsAt: secondStart,
      createdBy: 'agent',
    });

    const windowFrom = firstStart;
    const windowTo = new Date(secondStart.getTime() + 30 * 60 * 1000);

    const shortSlots = await listOpenSlots.execute({
      professionalId: fixtures.professionalId,
      procedureId: fixtures.procedureId, // 30min — cabe na folga
      fromUtc: windowFrom,
      toUtc: windowTo,
    });
    expect(shortSlots.some((slot) => slot.startsAt.getTime() === gapStart.getTime())).toBe(true);

    const longSlots = await listOpenSlots.execute({
      professionalId: fixtures.professionalId,
      procedureId: fixtures.procedureLongId, // 60min — nao cabe numa folga de 30min
      fromUtc: windowFrom,
      toUtc: windowTo,
    });
    expect(longSlots.some((slot) => slot.startsAt.getTime() === gapStart.getTime())).toBe(false);
  });
});

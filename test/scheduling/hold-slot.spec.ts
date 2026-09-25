import 'reflect-metadata';
import { TestingModule } from '@nestjs/testing';
import { AppointmentStatus } from '@prisma/client';
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

describe('HoldSlotUseCase', () => {
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

  it('RN-04: rejeita slot com menos de MIN_LEAD_TIME_HOURS (2h) de antecedencia', async () => {
    const tooSoon = alignedFutureSlot(FIXED_NOW, 0.5); // 30min a frente, config padrao exige 2h

    await expect(
      holdSlot.execute({
        professionalId: fixtures.professionalId,
        procedureId: fixtures.procedureId,
        patientId: fixtures.patientAId,
        startsAt: tooSoon,
        createdBy: 'agent',
      }),
    ).rejects.toThrow(InvalidSlotError);
  });

  it('RN-05: rejeita slot alem de MAX_LOOKAHEAD_DAYS (60 dias)', async () => {
    const tooFar = alignedFutureSlot(FIXED_NOW, 24 * 70); // 70 dias a frente, config padrao permite so 60

    await expect(
      holdSlot.execute({
        professionalId: fixtures.professionalId,
        procedureId: fixtures.procedureId,
        patientId: fixtures.patientAId,
        startsAt: tooFar,
        createdBy: 'agent',
      }),
    ).rejects.toThrow(InvalidSlotError);
  });

  it('RN-06: rejeita slot bloqueado por AvailabilityException', async () => {
    const blockedSlot = alignedFutureSlot(FIXED_NOW, 5);
    const blockedSlotEnd = new Date(blockedSlot.getTime() + 30 * 60 * 1000);

    await prisma.availabilityException.create({
      data: {
        professionalId: fixtures.professionalId,
        startsAt: blockedSlot,
        endsAt: blockedSlotEnd,
        blocking: true,
        reason: 'Bloqueio de teste',
      },
    });

    await expect(
      holdSlot.execute({
        professionalId: fixtures.professionalId,
        procedureId: fixtures.procedureId,
        patientId: fixtures.patientAId,
        startsAt: blockedSlot,
        createdBy: 'agent',
      }),
    ).rejects.toThrow(InvalidSlotError);
  });

  it('RN-07: novo hold do mesmo paciente libera (expira) o hold anterior', async () => {
    const firstSlot = alignedFutureSlot(FIXED_NOW, 10);
    const secondSlot = alignedFutureSlot(FIXED_NOW, 11);

    const firstHold = await holdSlot.execute({
      professionalId: fixtures.professionalId,
      procedureId: fixtures.procedureId,
      patientId: fixtures.patientAId,
      startsAt: firstSlot,
      createdBy: 'agent',
    });

    await holdSlot.execute({
      professionalId: fixtures.professionalId,
      procedureId: fixtures.procedureId,
      patientId: fixtures.patientAId,
      startsAt: secondSlot,
      createdBy: 'agent',
    });

    const firstAppointment = await prisma.appointment.findUnique({
      where: { id: firstHold.appointmentId },
    });
    expect(firstAppointment?.status).toBe(AppointmentStatus.EXPIRED);
  });

  it('criterio de aceite #9: slot com menos de 2h de antecedencia nunca aparece em ListOpenSlotsUseCase', async () => {
    const toUtc = new Date(FIXED_NOW.getTime() + 4 * 60 * 60 * 1000); // proximas 4h

    const openSlots = await listOpenSlots.execute({
      professionalId: fixtures.professionalId,
      procedureId: fixtures.procedureId,
      fromUtc: FIXED_NOW,
      toUtc,
    });

    const minAllowed = new Date(FIXED_NOW.getTime() + 2 * 60 * 60 * 1000);
    for (const slot of openSlots) {
      expect(slot.startsAt.getTime()).toBeGreaterThanOrEqual(minAllowed.getTime());
    }
  });

  it('caminho feliz: reserva um slot valido e retorna appointmentId + holdExpiresAt', async () => {
    const validSlot = alignedFutureSlot(FIXED_NOW, 20);

    const result = await holdSlot.execute({
      professionalId: fixtures.professionalId,
      procedureId: fixtures.procedureId,
      patientId: fixtures.patientBId,
      startsAt: validSlot,
      createdBy: 'agent',
    });

    expect(result.appointmentId).toBeTruthy();
    expect(result.holdExpiresAt.getTime()).toBeGreaterThan(FIXED_NOW.getTime());

    const appointment = await prisma.appointment.findUnique({ where: { id: result.appointmentId } });
    expect(appointment?.status).toBe(AppointmentStatus.HELD);
    expect(appointment?.startsAt.getTime()).toBe(validSlot.getTime());
    // Achado da Fase 6 (metricas de resolucao): createdBy nunca era
    // setado de verdade — agora e obrigatorio no input, sem default.
    expect(appointment?.createdBy).toBe('agent');
  });
});

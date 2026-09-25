import 'reflect-metadata';
import { TestingModule } from '@nestjs/testing';
import { AppointmentStatus } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfirmAppointmentUseCase, HoldExpiredError, HoldSlotUseCase } from '../../src/modules/scheduling';
import { PrismaAppointmentRepository } from '../../src/modules/scheduling/infrastructure/prisma-appointment.repository';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { FixedClock } from '../support/fixed-clock';
import { bootstrapSchedulingTestModule } from './support/bootstrap-scheduling-module';
import {
  alignedFutureSlot,
  FIXED_NOW,
  seedSchedulingFixtures,
  SchedulingFixtures,
} from './support/seed-scheduling-fixtures';

describe('ConfirmAppointmentUseCase', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let holdSlot: HoldSlotUseCase;
  let confirmAppointment: ConfirmAppointmentUseCase;
  let appointments: PrismaAppointmentRepository;
  let fixtures: SchedulingFixtures;

  beforeAll(async () => {
    moduleRef = await bootstrapSchedulingTestModule(new FixedClock(FIXED_NOW));
    prisma = moduleRef.get(PrismaService);
    holdSlot = moduleRef.get(HoldSlotUseCase);
    confirmAppointment = moduleRef.get(ConfirmAppointmentUseCase);
    appointments = moduleRef.get(PrismaAppointmentRepository);
    fixtures = await seedSchedulingFixtures(prisma);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('caminho feliz: confirma um hold valido, status vira CONFIRMED', async () => {
    const slot = alignedFutureSlot(FIXED_NOW, 5);
    const hold = await holdSlot.execute({
      professionalId: fixtures.professionalId,
      procedureId: fixtures.procedureId,
      patientId: fixtures.patientAId,
      startsAt: slot,
      createdBy: 'agent',
    });

    const result = await confirmAppointment.execute(hold.appointmentId);
    expect(result.appointmentId).toBe(hold.appointmentId);

    const appointment = await prisma.appointment.findUnique({ where: { id: hold.appointmentId } });
    expect(appointment?.status).toBe(AppointmentStatus.CONFIRMED);
    expect(appointment?.holdExpiresAt).toBeNull();
  });

  it('criterio de aceite #4: confirmar hold expirado falha com HoldExpiredError', async () => {
    const slot = alignedFutureSlot(FIXED_NOW, 6);
    const hold = await holdSlot.execute({
      professionalId: fixtures.professionalId,
      procedureId: fixtures.procedureId,
      patientId: fixtures.patientBId,
      startsAt: slot,
      createdBy: 'agent',
    });

    // Simula o TTL ja vencido sem esperar HOLD_TTL_MINUTES de verdade.
    await prisma.appointment.update({
      where: { id: hold.appointmentId },
      data: { holdExpiresAt: new Date(FIXED_NOW.getTime() - 1000) },
    });

    await expect(confirmAppointment.execute(hold.appointmentId)).rejects.toThrow(HoldExpiredError);

    const appointment = await prisma.appointment.findUnique({ where: { id: hold.appointmentId } });
    expect(appointment?.status).toBe(AppointmentStatus.HELD); // nao virou CONFIRMED
  });

  it(
    'criterio de aceite #3: hold expirado pelo job periodico libera o slot para outro paciente',
    async () => {
      const slot = alignedFutureSlot(FIXED_NOW, 7);
      const hold = await holdSlot.execute({
        professionalId: fixtures.professionalId,
        procedureId: fixtures.procedureId,
        patientId: fixtures.patientAId,
        startsAt: slot,
        createdBy: 'agent',
      });

      await prisma.appointment.update({
        where: { id: hold.appointmentId },
        data: { holdExpiresAt: new Date(FIXED_NOW.getTime() - 1000) },
      });

      // Chama a mesma logica que o ExpireHoldsJob roda a cada 1min — nao
      // esperamos o BullMQ de verdade, testamos o efeito (RN-08), nao o
      // agendamento em si (isso e responsabilidade do BullMQ).
      const expiredCount = await appointments.expireOverdueHolds(FIXED_NOW);
      expect(expiredCount).toBeGreaterThanOrEqual(1);

      const expiredAppointment = await prisma.appointment.findUnique({
        where: { id: hold.appointmentId },
      });
      expect(expiredAppointment?.status).toBe(AppointmentStatus.EXPIRED);

      // O slot esta livre de novo: outro paciente consegue reserva-lo.
      const newHold = await holdSlot.execute({
        professionalId: fixtures.professionalId,
        procedureId: fixtures.procedureId,
        patientId: fixtures.patientBId,
        startsAt: slot,
        createdBy: 'agent',
      });
      expect(newHold.appointmentId).not.toBe(hold.appointmentId);
    },
  );
});

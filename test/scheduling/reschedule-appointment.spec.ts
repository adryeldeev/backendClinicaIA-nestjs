import 'reflect-metadata';
import { TestingModule } from '@nestjs/testing';
import { AppointmentStatus } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ConfirmAppointmentUseCase,
  HoldSlotUseCase,
  InvalidSlotError,
  RescheduleAppointmentUseCase,
} from '../../src/modules/scheduling';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { FixedClock } from '../support/fixed-clock';
import { bootstrapSchedulingTestModule } from './support/bootstrap-scheduling-module';
import {
  alignedFutureSlot,
  FIXED_NOW,
  seedSchedulingFixtures,
  SchedulingFixtures,
} from './support/seed-scheduling-fixtures';

describe('RescheduleAppointmentUseCase', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let holdSlot: HoldSlotUseCase;
  let confirmAppointment: ConfirmAppointmentUseCase;
  let rescheduleAppointment: RescheduleAppointmentUseCase;
  let fixtures: SchedulingFixtures;

  beforeAll(async () => {
    moduleRef = await bootstrapSchedulingTestModule(new FixedClock(FIXED_NOW));
    prisma = moduleRef.get(PrismaService);
    holdSlot = moduleRef.get(HoldSlotUseCase);
    confirmAppointment = moduleRef.get(ConfirmAppointmentUseCase);
    rescheduleAppointment = moduleRef.get(RescheduleAppointmentUseCase);
    fixtures = await seedSchedulingFixtures(prisma);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  async function createConfirmedAppointment(patientId: string, startsAt: Date) {
    const hold = await holdSlot.execute({
      professionalId: fixtures.professionalId,
      procedureId: fixtures.procedureId,
      patientId,
      startsAt,
      createdBy: 'agent',
    });
    await confirmAppointment.execute(hold.appointmentId);
    return hold.appointmentId;
  }

  it(
    'criterio de aceite #11: remarcacao que falha na etapa de reserva do novo horario mantem a consulta original intacta',
    async () => {
      const oldSlot = alignedFutureSlot(FIXED_NOW, 10);
      const takenSlot = alignedFutureSlot(FIXED_NOW, 11);

      const oldAppointmentId = await createConfirmedAppointment(fixtures.patientAId, oldSlot);
      // Ocupa o horario para o qual o paciente A vai tentar remarcar.
      await createConfirmedAppointment(fixtures.patientBId, takenSlot);

      await expect(
        rescheduleAppointment.execute({
          appointmentId: oldAppointmentId,
          patientId: fixtures.patientAId,
          newStartsAt: takenSlot,
        }),
      ).rejects.toThrow(InvalidSlotError);

      const oldAppointment = await prisma.appointment.findUnique({ where: { id: oldAppointmentId } });
      expect(oldAppointment?.status).toBe(AppointmentStatus.CONFIRMED);
      expect(oldAppointment?.startsAt.getTime()).toBe(oldSlot.getTime());
    },
  );

  it('caminho feliz: remarcacao bem sucedida confirma o novo e cancela o antigo', async () => {
    const oldSlot = alignedFutureSlot(FIXED_NOW, 20);
    const newSlot = alignedFutureSlot(FIXED_NOW, 21);

    const oldAppointmentId = await createConfirmedAppointment(fixtures.patientAId, oldSlot);

    const result = await rescheduleAppointment.execute({
      appointmentId: oldAppointmentId,
      patientId: fixtures.patientAId,
      newStartsAt: newSlot,
    });

    expect(result.appointmentId).not.toBe(oldAppointmentId);

    const newAppointment = await prisma.appointment.findUnique({ where: { id: result.appointmentId } });
    expect(newAppointment?.status).toBe(AppointmentStatus.CONFIRMED);
    expect(newAppointment?.startsAt.getTime()).toBe(newSlot.getTime());

    const oldAppointment = await prisma.appointment.findUnique({ where: { id: oldAppointmentId } });
    expect(oldAppointment?.status).toBe(AppointmentStatus.CANCELLED);
  });
});

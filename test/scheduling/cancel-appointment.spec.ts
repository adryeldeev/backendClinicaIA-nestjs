import 'reflect-metadata';
import { TestingModule } from '@nestjs/testing';
import { AppointmentStatus } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CancelAppointmentUseCase,
  ConfirmAppointmentUseCase,
  HoldSlotUseCase,
  NotAppointmentOwnerError,
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

describe('CancelAppointmentUseCase', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let holdSlot: HoldSlotUseCase;
  let confirmAppointment: ConfirmAppointmentUseCase;
  let cancelAppointment: CancelAppointmentUseCase;
  let fixtures: SchedulingFixtures;

  beforeAll(async () => {
    moduleRef = await bootstrapSchedulingTestModule(new FixedClock(FIXED_NOW));
    prisma = moduleRef.get(PrismaService);
    holdSlot = moduleRef.get(HoldSlotUseCase);
    confirmAppointment = moduleRef.get(ConfirmAppointmentUseCase);
    cancelAppointment = moduleRef.get(CancelAppointmentUseCase);
    fixtures = await seedSchedulingFixtures(prisma);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  async function createConfirmedAppointment(patientId: string, hoursFromNow: number) {
    const slot = alignedFutureSlot(FIXED_NOW, hoursFromNow);
    const hold = await holdSlot.execute({
      professionalId: fixtures.professionalId,
      procedureId: fixtures.procedureId,
      patientId,
      startsAt: slot,
      createdBy: 'agent',
    });
    await confirmAppointment.execute(hold.appointmentId);
    return hold.appointmentId;
  }

  it('criterio de aceite #5: paciente A nao consegue cancelar consulta do paciente B', async () => {
    const appointmentId = await createConfirmedAppointment(fixtures.patientAId, 100);

    await expect(
      cancelAppointment.execute({ appointmentId, patientId: fixtures.patientBId }),
    ).rejects.toThrow(NotAppointmentOwnerError);

    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(appointment?.status).toBe(AppointmentStatus.CONFIRMED); // continua intacta
  });

  it('RN-12: cancelamento com menos de LATE_CANCEL_HOURS (24h) de antecedencia grava lateCancellation=true', async () => {
    const appointmentId = await createConfirmedAppointment(fixtures.patientAId, 10); // 10h < 24h

    await cancelAppointment.execute({ appointmentId, patientId: fixtures.patientAId, reason: 'Imprevisto' });

    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(appointment?.status).toBe(AppointmentStatus.CANCELLED);
    expect(appointment?.lateCancellation).toBe(true);
  });

  it('RN-12: cancelamento com mais de LATE_CANCEL_HOURS (24h) de antecedencia grava lateCancellation=false', async () => {
    const appointmentId = await createConfirmedAppointment(fixtures.patientBId, 72); // 72h > 24h

    await cancelAppointment.execute({ appointmentId, patientId: fixtures.patientBId });

    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    expect(appointment?.status).toBe(AppointmentStatus.CANCELLED);
    expect(appointment?.lateCancellation).toBe(false);
  });
});

import 'reflect-metadata';
import { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { AppointmentStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MESSAGING_PORT } from '../../src/modules/messaging';
import { SendAppointmentReminderJob } from '../../src/modules/messaging/application/send-appointment-reminder.job';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { CLOCK } from '../../src/shared/kernel/clock';
import { FakeMessagingPort } from '../support/fake-messaging-port';
import { FixedClock } from '../support/fixed-clock';
import { uniquePhone } from '../support/unique-phone';
import { waitFor } from '../support/wait-for';

const HOUR_MS = 60 * 60 * 1000;
const FIXED_NOW = new Date('2026-01-15T12:00:00.000Z');

/**
 * Fase 5: lembrete de 24h antes da consulta, via template — RN-18.
 * FixedClock (mesmo padrao da correcao de double-booking da Fase 2)
 * elimina qualquer dependencia do relogio real pra "24h a frente".
 */
describe('SendAppointmentReminderJob', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let job: SendAppointmentReminderJob;
  let fakeMessagingPort: FakeMessagingPort;

  beforeAll(async () => {
    const { AppModule } = await import('../../src/app.module');

    fakeMessagingPort = new FakeMessagingPort();
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_PORT)
      .useValue(fakeMessagingPort)
      .overrideProvider(CLOCK)
      .useValue(new FixedClock(FIXED_NOW))
      .compile();

    prisma = moduleRef.get(PrismaService);
    job = moduleRef.get(SendAppointmentReminderJob);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  async function seedConfirmedAppointment(startsAt: Date) {
    const clinic = await prisma.clinic.create({
      data: { name: `Clinica Reminder ${uniquePhone()}`, timezone: 'America/Fortaleza', addressLine: 'x', phone: `+${uniquePhone()}` },
    });
    const professional = await prisma.professional.create({
      data: { clinicId: clinic.id, name: 'Dr. Lembrete Teste', specialty: 'Geral' },
    });
    const procedure = await prisma.procedure.create({
      data: { clinicId: clinic.id, name: 'Consulta Teste', durationMin: 30 },
    });
    const patient = await prisma.patient.create({ data: { phoneE164: `+${uniquePhone()}` } });
    const appointment = await prisma.appointment.create({
      data: {
        professionalId: professional.id,
        patientId: patient.id,
        procedureId: procedure.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
        status: AppointmentStatus.CONFIRMED,
      },
    });
    return { appointment, patient };
  }

  it('consulta confirmada ~24h a frente recebe lembrete via template e fica marcada reminderSentAt', async () => {
    const startsAt = new Date(FIXED_NOW.getTime() + 24 * HOUR_MS + 5 * 60 * 1000); // 24h05min a frente — dentro da janela do tick
    const { appointment, patient } = await seedConfirmedAppointment(startsAt);

    await job.process({} as Job);

    await waitFor(() => prisma.outboxMessage.findFirst({ where: { toPhoneE164: patient.phoneE164 } }));

    const outboxMessage = await prisma.outboxMessage.findFirstOrThrow({ where: { toPhoneE164: patient.phoneE164 } });
    expect(outboxMessage.templateName).toBe('lembrete_consulta_24h');
    expect(outboxMessage.templateArgs).toEqual(['Consulta Teste', 'Dr. Lembrete Teste', expect.any(String)]);

    const updatedAppointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(updatedAppointment.reminderSentAt).not.toBeNull();
  });

  it('nao envia de novo (reminderSentAt ja setado) mesmo rodando o job outra vez', async () => {
    const startsAt = new Date(FIXED_NOW.getTime() + 24 * HOUR_MS + 10 * 60 * 1000);
    const { patient } = await seedConfirmedAppointment(startsAt);

    await job.process({} as Job);
    await waitFor(() => prisma.outboxMessage.findFirst({ where: { toPhoneE164: patient.phoneE164 } }));
    const countAfterFirst = fakeMessagingPort.sentTemplates.length;

    await job.process({} as Job);

    expect(fakeMessagingPort.sentTemplates.length).toBe(countAfterFirst); // segunda rodada nao adicionou nada novo
  });

  it('consulta fora da janela de 24h (ex.: daqui a 3 dias) nao recebe lembrete ainda', async () => {
    const startsAt = new Date(FIXED_NOW.getTime() + 3 * 24 * HOUR_MS);
    const { patient } = await seedConfirmedAppointment(startsAt);

    await job.process({} as Job);

    const outboxMessage = await prisma.outboxMessage.findFirst({ where: { toPhoneE164: patient.phoneE164 } });
    expect(outboxMessage).toBeNull();
  });
});

import { AppointmentStatus, PrismaClient } from '@prisma/client';

// Prefixo fixo, dedicado (diferente do prefixo de seed-conversations.ts —
// "98" em vez de "99" no numero local, pra nao colidir: se os dois scripts
// usassem o mesmo prefixo, rodar um apagaria as fixtures do outro por
// engano). Mesma logica ja aprovada la: idempotente, nunca toca em
// paciente/consulta fora do proprio prefixo.
const FIXTURE_PHONE_PREFIX = '+558598000000';
const BLOCKED_DAY_REASON = 'Fixture — bloqueio de agenda (ex.: ferias, congresso)';

// America/Fortaleza nao tem horario de verao — offset fixo, mesma
// convencao ja usada no resto do projeto (nunca calculado via Intl aqui).
const TIMEZONE_OFFSET_HOURS = 3;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Converte um horario LOCAL (America/Fortaleza) pra Date em UTC. */
function localToUtc(base: Date, daysFromNow: number, localHour: number, localMinute: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), localHour + TIMEZONE_OFFSET_HOURS, localMinute));
}

/** Primeiro dia util (segunda a sexta) a partir de `minDaysOut` dias a frente de `base`. */
function nextWeekdayOffset(base: Date, minDaysOut: number): number {
  let offset = minDaysOut;
  let day = new Date(base);
  day.setUTCDate(day.getUTCDate() + offset);
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) {
    offset += 1;
    day = new Date(base);
    day.setUTCDate(day.getUTCDate() + offset);
  }
  return offset;
}

interface AppointmentFixture {
  phoneSuffix: string;
  patientName: string;
  professionalName: string;
  procedureName: string;
  status: AppointmentStatus;
  startsAt: Date;
  endsAt: Date;
  holdExpiresAt: Date | null;
  cancelReason: string | null;
  lateCancellation: boolean;
}

/**
 * Seed repetivel de consultas em estados CONHECIDOS e NOMEADOS, mesma
 * ideia do seed:conversations (achado do usuario: economizou dias de
 * autorizacao conversa a conversa — agora o front testa a agenda sem
 * pedir dado caso a caso). Idempotente: cada rodada apaga e recria so as
 * PROPRIAS fixtures (telefone com FIXTURE_PHONE_PREFIX + o bloqueio de
 * agenda marcado com BLOCKED_DAY_REASON), nunca toca em consulta real.
 *
 * Depende do seed base (`npm run seed`) ja ter rodado — busca profissional
 * e procedimento por NOME, nunca por id fixo (id muda a cada reset —
 * mesma licao de seed-conversations/probes desta sessao).
 */
export async function seedTestAppointments(prisma: PrismaClient, now: Date = new Date()): Promise<void> {
  const existingPatients = await prisma.patient.findMany({
    where: { phoneE164: { startsWith: FIXTURE_PHONE_PREFIX } },
    select: { id: true },
  });
  const existingPatientIds = existingPatients.map((p) => p.id);
  if (existingPatientIds.length > 0) {
    await prisma.appointment.deleteMany({ where: { patientId: { in: existingPatientIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: existingPatientIds } } });
  }
  await prisma.availabilityException.deleteMany({ where: { reason: BLOCKED_DAY_REASON } });

  const drAna = await prisma.professional.findFirstOrThrow({
    where: { name: 'Dra. Ana Souza' },
  });
  const drCarlos = await prisma.professional.findFirstOrThrow({
    where: { name: 'Dr. Carlos Lima' },
  });
  const consultaGeral = await prisma.procedure.findFirstOrThrow({
    where: { name: 'Consulta Clinica Geral' },
  });
  const consultaCardio = await prisma.procedure.findFirstOrThrow({
    where: { name: 'Consulta Cardiologica' },
  });
  const retornoCardio = await prisma.procedure.findFirstOrThrow({
    where: { name: 'Retorno Cardiologico' },
  });

  // Dra. Ana: seg-sex 08:00-12:00 local. Dr. Carlos: seg-sex 14:00-18:00 local (ver prisma/seed.ts).
  const hojeOffset = 0;
  const semanaOffset = nextWeekdayOffset(now, 2);
  const heldTtlOffset = nextWeekdayOffset(now, 5);
  const heldVencidaOffset = nextWeekdayOffset(now, 6);
  const canceladaOffset = nextWeekdayOffset(now, 10);
  const bloqueioOffset = nextWeekdayOffset(now, 7);

  const fixtures: AppointmentFixture[] = [
    {
      phoneSuffix: '1',
      patientName: 'Fixture Confirmada Hoje',
      professionalName: drAna.name,
      procedureName: consultaGeral.name,
      status: AppointmentStatus.CONFIRMED,
      startsAt: localToUtc(now, hojeOffset, 9, 0),
      endsAt: localToUtc(now, hojeOffset, 9, 30),
      holdExpiresAt: null,
      cancelReason: null,
      lateCancellation: false,
    },
    {
      phoneSuffix: '2',
      patientName: 'Fixture Confirmada Esta Semana',
      professionalName: drCarlos.name,
      procedureName: consultaCardio.name,
      status: AppointmentStatus.CONFIRMED,
      startsAt: localToUtc(now, semanaOffset, 15, 0),
      endsAt: localToUtc(now, semanaOffset, 15, 40),
      holdExpiresAt: null,
      cancelReason: null,
      lateCancellation: false,
    },
    {
      phoneSuffix: '3',
      patientName: 'Fixture HELD Dentro do TTL',
      professionalName: drAna.name,
      procedureName: consultaGeral.name,
      status: AppointmentStatus.HELD,
      startsAt: localToUtc(now, heldTtlOffset, 8, 30),
      endsAt: localToUtc(now, heldTtlOffset, 9, 0),
      holdExpiresAt: new Date(now.getTime() + 5 * MINUTE_MS), // HOLD_TTL_MINUTES=10 — ainda valido
      cancelReason: null,
      lateCancellation: false,
    },
    {
      phoneSuffix: '4',
      patientName: 'Fixture HELD Vencida',
      professionalName: drCarlos.name,
      procedureName: retornoCardio.name,
      status: AppointmentStatus.HELD,
      startsAt: localToUtc(now, heldVencidaOffset, 14, 20),
      endsAt: localToUtc(now, heldVencidaOffset, 14, 40),
      holdExpiresAt: new Date(now.getTime() - 5 * MINUTE_MS), // vencida ha 5min — estado antes do ExpireHoldsJob varrer
      cancelReason: null,
      lateCancellation: false,
    },
    {
      phoneSuffix: '5',
      patientName: 'Fixture Cancelada',
      professionalName: drAna.name,
      procedureName: consultaGeral.name,
      status: AppointmentStatus.CANCELLED,
      startsAt: localToUtc(now, canceladaOffset, 10, 0),
      endsAt: localToUtc(now, canceladaOffset, 10, 30),
      holdExpiresAt: null,
      cancelReason: 'Paciente remarcou por conta propria',
      lateCancellation: false, // cancelada com dias de antecedencia — RN-12 nao se aplica
    },
    {
      phoneSuffix: '6',
      patientName: 'Fixture Cancelamento Tardio',
      professionalName: drCarlos.name,
      procedureName: consultaCardio.name,
      status: AppointmentStatus.CANCELLED,
      startsAt: new Date(now.getTime() + 10 * HOUR_MS), // dentro de LATE_CANCEL_HOURS=24 — RN-12
      endsAt: new Date(now.getTime() + 10 * HOUR_MS + 40 * MINUTE_MS),
      holdExpiresAt: null,
      cancelReason: 'Paciente cancelou em cima da hora',
      lateCancellation: true,
    },
  ];

  for (const fixture of fixtures) {
    const patient = await prisma.patient.create({
      data: { phoneE164: `${FIXTURE_PHONE_PREFIX}${fixture.phoneSuffix}`, name: fixture.patientName },
    });
    const professional = fixture.professionalName === drAna.name ? drAna : drCarlos;
    const procedure =
      fixture.procedureName === consultaGeral.name
        ? consultaGeral
        : fixture.procedureName === consultaCardio.name
          ? consultaCardio
          : retornoCardio;

    await prisma.appointment.create({
      data: {
        professionalId: professional.id,
        patientId: patient.id,
        procedureId: procedure.id,
        startsAt: fixture.startsAt,
        endsAt: fixture.endsAt,
        status: fixture.status,
        holdExpiresAt: fixture.holdExpiresAt,
        cancelReason: fixture.cancelReason ?? undefined,
        lateCancellation: fixture.lateCancellation,
        createdBy: 'human',
      },
    });
  }

  // Dia inteiro bloqueado pro Dr. Carlos — cobre a janela de disponibilidade
  // dele (14:00-18:00 local) por completo, entao nenhum slot aparece nesse
  // dia mesmo com a AvailabilityRule normal ativa.
  await prisma.availabilityException.create({
    data: {
      professionalId: drCarlos.id,
      startsAt: localToUtc(now, bloqueioOffset, 0, 0),
      endsAt: localToUtc(now, bloqueioOffset, 23, 59),
      reason: BLOCKED_DAY_REASON,
      blocking: true,
    },
  });

  console.log(
    'Seed de consultas concluido:',
    fixtures.map((f) => `${f.patientName} (${f.status}, ${f.professionalName})`).concat(`Bloqueio de agenda (${drCarlos.name})`),
  );
}

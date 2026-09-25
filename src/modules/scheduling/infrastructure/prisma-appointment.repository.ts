import { Injectable } from '@nestjs/common';
import { Appointment, AppointmentStatus } from '@prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { ExclusionViolationError } from '../../../shared/kernel/errors/exclusion-violation.error';
import { SlotTakenError } from '../domain/errors/slot-taken.error';
import type { AppointmentScope } from '../domain/services/resolve-appointment-scope';

const ACTIVE_STATUSES: AppointmentStatus[] = [AppointmentStatus.HELD, AppointmentStatus.CONFIRMED];

/** Nome real da constraint EXCLUDE — ver migration 20260917170000_appointment_no_overlap. */
const APPOINTMENT_NO_OVERLAP_CONSTRAINT = 'appointment_no_overlap';

/**
 * Revisao do usuario (2026-09-24, duas rodadas):
 *
 * 1a rodada: a versao anterior tambem aceitava `DuplicateEntryError`/P2002
 * cru como "slot ocupado". Achado do usuario: `Appointment` NAO TEM
 * nenhuma constraint unica — a antiga (`appointment_active_slot_unique`)
 * foi DROPADA na mesma migration que criou o EXCLUDE, exatamente porque so
 * cobria mesmo horario exato, nao sobreposicao de intervalo. Nao existe
 * alvo legitimo de P2002 nesta tabela — removido sem checagem de alvo, ja
 * que nao ha alvo real pra checar.
 *
 * 2a rodada: `mapPrismaError` agora tambem traduz 23P01 (antes so P20xx) —
 * pra `ExclusionViolationError`, NUM LUGAR SO, antes de sair do
 * repositorio (mesmo motivo da 1a rodada: raw Prisma error nao chega mais
 * aqui, era ramo morto). Igual DuplicateEntryError/ReferencedEntityNotFoundError,
 * checa o ALVO (`constraint`), nao so o tipo: uma EXCLUDE de OUTRA tabela
 * (se vier a existir) nao pode ser lida como "horario ocupado".
 */
export function isSlotConflict(error: unknown): boolean {
  return error instanceof ExclusionViolationError && error.constraint === APPOINTMENT_NO_OVERLAP_CONSTRAINT;
}

// SQLSTATE do Postgres pra "deadlock_detected".
const POSTGRES_DEADLOCK_CODE = '40P01';

/**
 * Achado do usuario (2026-09-24), pego pelo proprio teste de concorrencia
 * real (nao suposicao): sob corrida genuina pela MESMA constraint EXCLUDE,
 * o Postgres as vezes nao devolve exclusion_violation (23P01) direto —
 * devolve deadlock_detected (40P01) primeiro, porque as duas transacoes
 * precisam de ShareLock uma na outra pra verificar a exclusao (comportamento
 * documentado do Postgres pra constraints EXCLUDE sob concorrencia real,
 * nao um caso hipotetico: reproduzido em ~27% de 30 rodadas com um probe
 * dedicado). Deadlock e generico — NAO e seguro tratar como "slot ocupado"
 * sem mais informacao (pode ser deadlock de outra causa), mas TAMBEM nao e
 * seguro deixar vazar cru: e falha transitoria de fato, a pratica
 * recomendada pelo proprio Postgres e retentar a transacao abortada.
 * Nao passa por `mapPrismaError` (mesmo motivo do 23P01: nao e
 * `PrismaClientKnownRequestError`) — tratado aqui, local ao unico modulo
 * onde essa corrida especifica pode acontecer.
 */
function isDeadlock(error: unknown): boolean {
  return error instanceof Error && error.message.includes(POSTGRES_DEADLOCK_CODE);
}

/**
 * Sem default de proposito (mesmo espirito do AppointmentScope): quem
 * chama holdSlot precisa decidir explicitamente quem esta reservando —
 * achado da Fase 6 (metricas de resolucao), createdBy existia no schema
 * desde a Fase 2 mas nunca era setado em lugar nenhum do codigo, todo
 * agendamento (inclusive os manuais do painel admin) caia no default
 * "agent" da coluna.
 */
export type AppointmentCreatedBy = 'agent' | 'human';

export interface HoldSlotData {
  professionalId: string;
  patientId: string;
  procedureId: string;
  startsAt: Date;
  endsAt: Date;
  holdExpiresAt: Date;
  createdBy: AppointmentCreatedBy;
}

export interface BookedInterval {
  startsAt: Date;
  endsAt: Date;
}

@Injectable()
export class PrismaAppointmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Appointment | null> {
    return this.prisma.appointment.findUnique({ where: { id } });
  }

  findActiveHoldByPatient(patientId: string): Promise<Appointment | null> {
    return this.prisma.appointment.findFirst({
      where: { patientId, status: AppointmentStatus.HELD },
    });
  }

  async listBookedIntervals(
    professionalId: string,
    fromUtc: Date,
    toUtc: Date,
  ): Promise<BookedInterval[]> {
    return this.prisma.appointment.findMany({
      where: {
        professionalId,
        status: { in: ACTIVE_STATUSES },
        startsAt: { lt: toUtc },
        endsAt: { gt: fromUtc },
      },
      select: { startsAt: true, endsAt: true },
    });
  }

  /**
   * Achado do usuario (2026-09-24, segunda rodada): a protecao contra
   * deadlock (40P01) nao pode ficar so em `holdSlot` — `confirmHeld` e
   * `cancel` tambem escrevem `status` em `Appointment` (coluna coberta
   * pelo predicado da constraint EXCLUDE `appointment_no_overlap`), e a
   * remarcacao encadeia os tres (reserva o novo via holdSlot, confirma,
   * cancela o antigo) — qualquer um dos tres pode competir pela mesma
   * constraint sob corrida real. Nucleo compartilhado, nao duplicado por
   * metodo: teto de 2 retentativas (3 tentativas no total) — generoso o
   * bastante pro caso real (duas transacoes concorrentes, uma vence
   * rapido) sem virar recursao sem fim num cenario patologico. Relanca o
   * erro cru se esgotar — cada chamador decide o que fazer com ele (ver
   * `holdSlot`, unico que hoje tem uma traducao de dominio especifica pra
   * esse caso).
   */
  private async withDeadlockRetry<T>(operation: () => Promise<T>, retriesLeft = 2): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (isDeadlock(error) && retriesLeft > 0) {
        return this.withDeadlockRetry(operation, retriesLeft - 1);
      }
      throw error;
    }
  }

  /**
   * Insere o HELD. Se violar a constraint de exclusao appointment_no_overlap
   * (23P01) traduz para SlotTakenError aqui mesmo — o chamador nunca ve
   * Prisma. Ver decisao 2 do plano da Fase 2 e o comentario de
   * `isSlotConflict` acima (P2002 removido do escopo, sem alvo legitimo).
   *
   * Achado do usuario (2026-09-24): se o deadlock persistir alem do teto
   * de `withDeadlockRetry`, o erro que sobra AINDA e sobre a mesma corrida
   * pelo mesmo slot — nunca deveria virar 500 generico pro paciente so
   * porque a retentativa nao teve tempo de resolver. Traduzido pra
   * SlotTakenError tambem, igual exclusion_violation: "esse horario acabou
   * de ser ocupado" e verdade nos dois casos, do ponto de vista de quem
   * pediu o agendamento.
   */
  async holdSlot(data: HoldSlotData): Promise<Appointment> {
    try {
      return await this.withDeadlockRetry(() =>
        this.prisma.appointment.create({
          data: { ...data, status: AppointmentStatus.HELD },
        }),
      );
    } catch (error) {
      if (isSlotConflict(error) || isDeadlock(error)) {
        throw new SlotTakenError();
      }
      throw error;
    }
  }

  /**
   * Compare-and-swap da secao 10 da spec. Retorna null se zero linhas
   * afetadas (expirou ou perdeu a corrida de concorrencia) — o chamador
   * (ConfirmAppointmentUseCase) decide o que isso significa.
   */
  async confirmHeld(id: string, expectedVersion: number, now: Date): Promise<Appointment | null> {
    const result = await this.withDeadlockRetry(() =>
      this.prisma.appointment.updateMany({
        where: {
          id,
          version: expectedVersion,
          status: AppointmentStatus.HELD,
          holdExpiresAt: { gt: now },
        },
        data: {
          status: AppointmentStatus.CONFIRMED,
          version: { increment: 1 },
          holdExpiresAt: null,
        },
      }),
    );

    if (result.count === 0) {
      return null;
    }
    return this.findById(id);
  }

  /**
   * Libera imediatamente um hold ativo (RN-07: novo hold do mesmo paciente
   * libera o anterior). Reaproveita status EXPIRED — semanticamente e o
   * mesmo desfecho de "essa reserva nao vale mais".
   */
  async expireById(id: string): Promise<void> {
    await this.withDeadlockRetry(() =>
      this.prisma.appointment.updateMany({
        where: { id, status: AppointmentStatus.HELD },
        data: { status: AppointmentStatus.EXPIRED, holdExpiresAt: null },
      }),
    );
  }

  /**
   * Job periodico (RN-08). Retorna quantos holds foram expirados.
   */
  async expireOverdueHolds(now: Date): Promise<number> {
    const result = await this.withDeadlockRetry(() =>
      this.prisma.appointment.updateMany({
        where: { status: AppointmentStatus.HELD, holdExpiresAt: { lt: now } },
        data: { status: AppointmentStatus.EXPIRED, holdExpiresAt: null },
      }),
    );
    return result.count;
  }

  async cancel(id: string, cancelReason: string | undefined, lateCancellation: boolean): Promise<Appointment> {
    return this.withDeadlockRetry(() =>
      this.prisma.appointment.update({
        where: { id },
        data: { status: AppointmentStatus.CANCELLED, cancelReason, lateCancellation },
      }),
    );
  }

  /** Tool `consultar_minhas_consultas`: so futuras e confirmadas. */
  findUpcomingConfirmedByPatient(patientId: string, now: Date): Promise<AppointmentWithProfessional[]> {
    return this.prisma.appointment.findMany({
      where: { patientId, status: AppointmentStatus.CONFIRMED, startsAt: { gt: now } },
      include: { professional: true },
      orderBy: { startsAt: 'asc' },
    });
  }

  /**
   * GET /api/admin/patients/:id/appointments (achado do usuario,
   * 2026-09-25) — TODOS os status (diferente de findUpcomingConfirmedByPatient,
   * que e so pra tool do agente: so CONFIRMED, so futuro). O painel
   * precisa ver HELD/CANCELLED tambem, nao so o que ja foi confirmado.
   */
  findAllByPatient(patientId: string): Promise<AppointmentWithProfessional[]> {
    return this.prisma.appointment.findMany({
      where: { patientId },
      include: { professional: true },
      orderBy: { startsAt: 'desc' },
    });
  }

  /**
   * Fase 5 (lembrete de 24h): confirmadas cujo startsAt cai dentro da
   * janela do job e que ainda nao tiveram lembrete enviado.
   * `patient`/`procedure` sao lidos via relacao do proprio Appointment —
   * mesmo padrao ja usado pra `professional` acima (scheduling nao
   * reimplementa logica de outro modulo, so le o dado pela FK que ja
   * existe na sua propria tabela).
   */
  findConfirmedNeedingReminder(windowStart: Date, windowEnd: Date): Promise<AppointmentForReminder[]> {
    return this.prisma.appointment.findMany({
      where: {
        status: AppointmentStatus.CONFIRMED,
        startsAt: { gte: windowStart, lte: windowEnd },
        reminderSentAt: null,
      },
      include: { patient: true, professional: true, procedure: true },
    });
  }

  async markReminderSent(id: string, now: Date): Promise<void> {
    await this.prisma.appointment.update({
      where: { id },
      data: { reminderSentAt: now },
    });
  }

  /**
   * GET /api/admin/appointments. `scope` e parametro obrigatorio (tipo
   * AppointmentScope, sem default) de proposito — ver o comentario em
   * resolve-appointment-scope.ts. Nenhuma chamada a este metodo compila
   * sem decidir "todas as agendas" ou "so uma".
   */
  listByRange(range: { from: Date; to: Date }, scope: AppointmentScope): Promise<AppointmentWithProfessional[]> {
    return this.prisma.appointment.findMany({
      where: {
        startsAt: { gte: range.from },
        endsAt: { lte: range.to },
        ...(scope.kind === 'professional' ? { professionalId: scope.professionalId } : {}),
      },
      include: { professional: true },
      orderBy: { startsAt: 'asc' },
    });
  }

  /**
   * Etapa 3 (Fase 6) — impacto de desativar um profissional (Caso 1) ou
   * reduzir/remover uma AvailabilityRule (Caso 3): todas as consultas
   * CONFIRMADAS futuras, sem limite de data — o chamador decide o que
   * fazer com a lista (avisar, nunca cancela nada aqui).
   */
  listFutureConfirmedByProfessional(professionalId: string, now: Date): Promise<Appointment[]> {
    return this.prisma.appointment.findMany({
      where: { professionalId, status: AppointmentStatus.CONFIRMED, startsAt: { gt: now } },
      orderBy: { startsAt: 'asc' },
    });
  }

  /** Mesma ideia, Caso 1 pra Procedure (desativar procedimento). */
  listFutureConfirmedByProcedure(procedureId: string, now: Date): Promise<Appointment[]> {
    return this.prisma.appointment.findMany({
      where: { procedureId, status: AppointmentStatus.CONFIRMED, startsAt: { gt: now } },
      orderBy: { startsAt: 'asc' },
    });
  }

  /**
   * GET /api/admin/metrics — atribuicao por ORIGEM (createdBy), nao por
   * quem executou a acao (ver nota da secao 5 da SPEC.md): cancelamento e
   * remarcacao mudam status na MESMA linha, sem registrar quem agiu, so
   * quem criou. status HELD nunca conta (nao chegou a ser "realizado").
   */
  countCreatedByInPeriod(createdBy: AppointmentCreatedBy, from: Date, to: Date): Promise<number> {
    return this.prisma.appointment.count({
      where: {
        createdBy,
        createdAt: { gte: from, lt: to },
        status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CANCELLED] },
      },
    });
  }

  /** RN-13: remarcacao cancela a consulta antiga com cancelReason fixo 'Remarcado'. */
  countReschedulesByInPeriod(createdBy: AppointmentCreatedBy, from: Date, to: Date): Promise<number> {
    return this.prisma.appointment.count({
      where: {
        createdBy,
        status: AppointmentStatus.CANCELLED,
        cancelReason: 'Remarcado',
        updatedAt: { gte: from, lt: to },
      },
    });
  }

  /** Qualquer CANCELLED que nao seja consequencia de remarcacao. */
  countCancellationsByInPeriod(createdBy: AppointmentCreatedBy, from: Date, to: Date): Promise<number> {
    return this.prisma.appointment.count({
      where: {
        createdBy,
        status: AppointmentStatus.CANCELLED,
        cancelReason: { not: 'Remarcado' },
        updatedAt: { gte: from, lt: to },
      },
    });
  }
}

export type AppointmentWithProfessional = Appointment & {
  professional: { id: string; name: string };
};

export type AppointmentForReminder = Appointment & {
  patient: { phoneE164: string };
  professional: { name: string };
  procedure: { name: string };
};

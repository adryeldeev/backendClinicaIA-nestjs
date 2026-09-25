import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { AppointmentNotFoundError } from '../domain/errors/appointment-not-found.error';
import { HoldExpiredError } from '../domain/errors/hold-expired.error';
import { PrismaAppointmentRepository } from '../infrastructure/prisma-appointment.repository';

export interface ConfirmAppointmentResult {
  appointmentId: string;
}

@Injectable()
export class ConfirmAppointmentUseCase {
  private readonly logger = new Logger(ConfirmAppointmentUseCase.name);

  constructor(
    private readonly appointments: PrismaAppointmentRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(holdId: string): Promise<ConfirmAppointmentResult> {
    const appointment = await this.appointments.findById(holdId);
    if (!appointment) {
      throw new AppointmentNotFoundError(holdId);
    }

    const now = this.clock.now();

    // Le a versao atual e tenta o compare-and-swap com ela (decisao 1 do
    // plano da Fase 2). Zero linhas afetadas = expirou ou perdeu a corrida
    // de concorrencia — o ERRO DE DOMINIO continua unico (mesma acao de
    // recuperacao nos dois casos), mas o LOG distingue: daqui a um mes,
    // saber se o problema e TTL curto demais ou colisao real de pacientes
    // muda o que se faz a respeito.
    const confirmed = await this.appointments.confirmHeld(appointment.id, appointment.version, now);
    if (!confirmed) {
      await this.logHoldFailureReason(holdId, appointment.version, now);
      throw new HoldExpiredError();
    }

    return { appointmentId: confirmed.id };
  }

  private async logHoldFailureReason(holdId: string, expectedVersion: number, now: Date): Promise<void> {
    const current = await this.appointments.findById(holdId);

    if (!current) {
      this.logger.warn(`Hold ${holdId} nao encontrado ao diagnosticar falha de confirmacao.`);
      return;
    }

    if (current.status !== AppointmentStatus.HELD) {
      this.logger.warn(
        `Hold ${holdId} nao confirmado: status ja mudou para ${current.status} ` +
          `(provavel corrida de concorrencia — outro processo alterou o appointment).`,
      );
      return;
    }

    if (current.holdExpiresAt && current.holdExpiresAt.getTime() <= now.getTime()) {
      this.logger.warn(
        `Hold ${holdId} nao confirmado: TTL vencido em ${current.holdExpiresAt.toISOString()} ` +
          `(considerar se HOLD_TTL_MINUTES esta curto demais para o fluxo real de confirmacao).`,
      );
      return;
    }

    if (current.version !== expectedVersion) {
      this.logger.warn(
        `Hold ${holdId} nao confirmado: version lida=${expectedVersion}, atual=${current.version} ` +
          `(corrida de concorrencia real — outra requisicao mexeu no appointment entre a leitura e o confirm).`,
      );
      return;
    }

    this.logger.warn(`Hold ${holdId} nao confirmado por motivo nao identificado.`);
  }
}

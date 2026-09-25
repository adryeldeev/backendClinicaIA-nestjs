import { DomainError } from '../../../../shared/kernel/domain-error';

/**
 * RN da secao 5 (RBAC): PROFISSIONAL so mexe na propria agenda. Distinto de
 * NotAppointmentOwnerError (esse e sobre PACIENTE dono da consulta, usado
 * no fluxo do agente via WhatsApp) — aqui quem age e um User do painel, e
 * "dono" e sobre professionalId, nao patientId.
 */
export class AppointmentOutOfScopeError extends DomainError {
  readonly code = 'APPOINTMENT_OUT_OF_SCOPE';
  readonly httpStatus = 403;

  constructor() {
    super('Essa consulta não pertence à agenda deste profissional.');
  }
}

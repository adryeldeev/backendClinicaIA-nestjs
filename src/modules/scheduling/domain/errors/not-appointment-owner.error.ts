import { DomainError } from '../../../../shared/kernel/domain-error';

/**
 * RN-14: paciente so le, cancela ou remarca consulta vinculada ao proprio
 * patientId. Verificacao no servico, nao no prompt.
 */
export class NotAppointmentOwnerError extends DomainError {
  readonly code = 'NOT_APPOINTMENT_OWNER';
  readonly httpStatus = 403;

  constructor() {
    super('Essa consulta não pertence a este paciente.');
  }
}

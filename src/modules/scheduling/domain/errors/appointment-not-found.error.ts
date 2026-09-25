import { DomainError } from '../../../../shared/kernel/domain-error';

export class AppointmentNotFoundError extends DomainError {
  readonly code = 'APPOINTMENT_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(appointmentId: string) {
    super(`Consulta ${appointmentId} não encontrada.`);
  }
}

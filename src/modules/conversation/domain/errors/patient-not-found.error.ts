import { DomainError } from '../../../../shared/kernel/domain-error';

export class PatientNotFoundError extends DomainError {
  readonly code = 'PATIENT_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(patientId: string) {
    super(`Paciente ${patientId} não encontrado.`);
  }
}

import { DomainError } from '../../../../shared/kernel/domain-error';

/**
 * Achado do usuario (2026-09-25): o caso mais comum do balcao — a pessoa
 * ja conversou pelo WhatsApp e ja tem cadastro. `details.existingPatientId`
 * deixa a tela oferecer "esse paciente ja existe, abrir cadastro" em vez
 * de so dizer que falhou.
 */
export class PatientPhoneAlreadyRegisteredError extends DomainError {
  readonly code = 'PATIENT_PHONE_ALREADY_REGISTERED';
  readonly httpStatus = 409;
  readonly details: { existingPatientId: string };

  constructor(existingPatientId: string) {
    super('Já existe um paciente cadastrado com esse telefone.');
    this.details = { existingPatientId };
  }
}

import { DomainError } from '../../../../shared/kernel/domain-error';

/**
 * RN-04 (lead time minimo), RN-05 (limite de antecedencia maxima) ou RN-06
 * (fora da grade do profissional / bloqueado por excecao / ja ocupado).
 */
export class InvalidSlotError extends DomainError {
  readonly code = 'INVALID_SLOT';
  readonly httpStatus = 400;

  constructor(reason: string) {
    super(`Horário inválido: ${reason}`);
  }
}

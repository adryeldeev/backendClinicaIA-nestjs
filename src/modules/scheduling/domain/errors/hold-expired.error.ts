import { DomainError } from '../../../../shared/kernel/domain-error';

/**
 * "0 linhas afetadas = expirou ou concorrencia -> recomeca oferta" (secao
 * 10 da spec). As duas causas tem a mesma acao de recuperacao, entao nao
 * ha dois erros separados aqui — ver decisao 1 do plano da Fase 2.
 */
export class HoldExpiredError extends DomainError {
  readonly code = 'HOLD_EXPIRED';
  readonly httpStatus = 409;

  constructor() {
    super('Essa reserva já expirou ou foi alterada. Escolha um horário novamente.');
  }
}

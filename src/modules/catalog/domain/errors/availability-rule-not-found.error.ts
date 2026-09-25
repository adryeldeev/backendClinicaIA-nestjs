import { DomainError } from '../../../../shared/kernel/domain-error';

export class AvailabilityRuleNotFoundError extends DomainError {
  readonly code = 'AVAILABILITY_RULE_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(ruleId: string) {
    super(`Regra de disponibilidade ${ruleId} não encontrada.`);
  }
}

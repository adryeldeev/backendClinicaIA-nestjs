import { DomainError } from '../domain-error';

/**
 * Traducao generica de P2025 (registro esperado nao encontrado — update/
 * delete num id que nao existe) do Prisma. Rede de seguranca pra qualquer
 * repositorio que ainda nao tenha uma checagem de existencia propria antes
 * de mutar (ex.: achado real em deleteAvailabilityException, corrigido com
 * checagem explicita — isso aqui cobre o resto e qualquer corrida futura).
 */
export class RecordNotFoundError extends DomainError {
  readonly code = 'RECORD_NOT_FOUND';
  readonly httpStatus = 404;

  constructor() {
    super('O registro solicitado não foi encontrado.');
  }
}

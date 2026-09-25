import { DomainError } from '../domain-error';

/**
 * Traducao generica de 23P01 (violacao de constraint EXCLUDE) do Postgres.
 * Achado do usuario (2026-09-24): a extensao central da PrismaService so
 * traduzia P2002/P2003/P2025 (PrismaClientKnownRequestError) — 23P01 e
 * OUTRO tipo (PrismaClientUnknownRequestError, o Prisma nao reconhece
 * exclusion_violation como "known error"), passava direto pro
 * AllExceptionsFilter em qualquer lugar que nao fosse o unico call site
 * que ja tratava isso na mao (isSlotConflict, appointment_no_overlap).
 * Mesma classe de bug do achado original de FK/unique/not-found, so que
 * num tipo de erro do Prisma diferente.
 */
export class ExclusionViolationError extends DomainError {
  readonly code = 'EXCLUSION_VIOLATION';
  readonly httpStatus = 409;

  /**
   * Nome da constraint EXCLUDE que violou (ex.: "appointment_no_overlap"),
   * extraido da mensagem do Postgres — mesmo motivo do `fields` em
   * DuplicateEntryError e do `field` em ReferencedEntityNotFoundError:
   * quem captura por tipo, sem checar QUAL constraint, trataria qualquer
   * EXCLUDE futura (de outra tabela, outro significado) como se fosse a
   * que espera.
   */
  readonly constraint?: string;

  constructor(constraint?: string) {
    super('Esse registro conflita com outro já existente para os mesmos critérios.');
    this.constraint = constraint;
  }
}

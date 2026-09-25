import { DomainError } from '../domain-error';

/**
 * Traducao generica de P2003 (violacao de FK) do Prisma — achado do
 * usuario, regressao de 2026-09-24: POST /catalog/professionals com
 * clinicId inexistente vazava P2003 cru pro AllExceptionsFilter, virando
 * 500 pra um erro que e do cliente (referencia invalida no corpo da
 * requisicao), nao interno. Nunca inclui nome de constraint/coluna na
 * mensagem — so no log do servidor (SEC-02).
 */
export class ReferencedEntityNotFoundError extends DomainError {
  readonly code = 'REFERENCED_ENTITY_NOT_FOUND';
  readonly httpStatus = 400;

  /**
   * Nome da coluna de FK que falhou (ex.: "professionalId"), extraido de
   * `error.meta.constraint` do P2003 — mesmo motivo do `fields` em
   * DuplicateEntryError: quem captura este erro por tipo, sem saber QUAL
   * referencia falhou, nao consegue distinguir "e a referencia que eu
   * esperava" de "e outra, sem relacao". `undefined` quando o formato do
   * `constraint` nao bate com a convencao esperada (nao trava a traducao
   * generica por isso).
   */
  readonly field?: string;

  constructor(field?: string) {
    super('Um dos identificadores enviados não corresponde a um registro existente.');
    this.field = field;
  }
}

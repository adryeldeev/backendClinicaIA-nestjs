import { DomainError } from '../domain-error';

/**
 * Traducao generica de P2002 (violacao de unique constraint) do Prisma.
 * `fields` vem de `error.meta.target` — pro provider Postgres, e o nome de
 * COLUNA de verdade (nao um identificador de constraint interno), seguro
 * de expor: ajuda quem preencheu o formulario sem vazar detalhe de schema.
 */
export class DuplicateEntryError extends DomainError {
  readonly code = 'DUPLICATE_ENTRY';
  readonly httpStatus = 409;

  /**
   * Achado do usuario (2026-09-24): tipo sozinho nao basta pra quem
   * captura este erro pra logica propria (idempotencia, corrida de
   * criacao) — sem saber QUAL coluna colidiu, o chamador aceitaria
   * qualquer violacao de unicidade naquele caminho como se fosse a que
   * ele espera, escondendo um bug real atras de um comportamento
   * "correto" por acidente. Guardado como array (nao so na mensagem)
   * pra dar pro chamador checar antes de agir.
   */
  readonly fields: string[];

  constructor(fields: string[] = []) {
    const suffix = fields.length > 0 ? ` para: ${fields.join(', ')}` : '';
    super(`Já existe um registro com esses dados${suffix}.`);
    this.fields = fields;
  }
}

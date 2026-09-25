/**
 * Base pros erros de dominio que cruzam pra fora do modulo (ex.: alcancam um
 * controller HTTP). `code` vira o `error.code` na resposta uniforme da API
 * admin (secao 5 da SPEC.md); `httpStatus` decide o status da resposta.
 * Nenhum mapa central pra manter — cada erro concreto ja sabe o que
 * significa, o `domain-exception.filter.ts` so le essas duas propriedades.
 *
 * Erros que nunca cruzam a fronteira do processo (ex.: sao sempre pegos e
 * traduzidos pra texto amigavel dentro do proprio modulo, como hoje o
 * orquestrador faz com `toFriendlyMessage`) nao precisam estender isso.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;

  /**
   * Dado extra especifico do erro, exposto no corpo da resposta junto de
   * code/message (achado do usuario, 2026-09-25: telefone duplicado em
   * POST /patients precisa devolver o id do paciente existente, pra tela
   * oferecer "esse paciente ja existe, abrir cadastro" em vez de so dizer
   * que falhou — o caso mais comum do balcao). SEC-02 continua valendo:
   * so dado que o proprio chamador ja tinha ou tem legitimo motivo de ver
   * (aqui, um id que ele mesmo vai usar em seguida) — nunca detalhe
   * interno (stack, nome de constraint/tabela). Opcional: a maioria dos
   * erros de dominio nao precisa disso, so code+message.
   */
  readonly details?: Record<string, unknown>;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

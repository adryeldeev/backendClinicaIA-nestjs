import { DomainError } from '../../../../shared/kernel/domain-error';

/**
 * Invariante da secao 5: "User.professionalId e obrigatorio quando role =
 * PROFISSIONAL" — mas o Prisma nao aplica isso no schema (campo opcional
 * pros outros papeis), so um comentario. Se isso falhar, e bug de cadastro
 * de usuario (fora do escopo desta CLI/fase resolver), nao um caso de uso
 * normal — mas negar explicitamente (403) e sempre melhor que 500 ou,
 * pior, silenciosamente tratar como "sem escopo" (poderia mascarar
 * degenerar pra {kind:'professional', professionalId:''} e nunca dar erro
 * nenhum, só devolver sempre lista vazia sem ninguem perceber o motivo).
 */
export class ProfessionalUserMisconfiguredError extends DomainError {
  readonly code = 'PROFESSIONAL_USER_MISCONFIGURED';
  readonly httpStatus = 403;

  constructor(userId: string) {
    super(`Usuário ${userId} tem papel PROFISSIONAL mas nenhum professionalId vinculado.`);
  }
}

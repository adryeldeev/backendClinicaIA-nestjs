import { DomainError } from '../../../../shared/kernel/domain-error';

/**
 * CreateFirstAdminUseCase e SO pra bootstrap (Etapa 1 da Fase 6, achado do
 * usuario: sem isso, subir a API em producao nao tem nenhum caminho pra
 * entrar no painel). Deliberadamente recusa rodar de novo se ja existe
 * ADMIN — nao e uma porta dos fundos pra criar admin extra a vontade;
 * usuario adicional e CRUD pelo painel (fora do escopo desta CLI).
 */
export class AdminAlreadyExistsError extends DomainError {
  readonly code = 'ADMIN_ALREADY_EXISTS';
  readonly httpStatus = 409;

  constructor(existingCount: number) {
    super(
      `Já existe(m) ${existingCount} usuário(s) ADMIN cadastrado(s). ` +
        'Este bootstrap só cria o PRIMEIRO admin — para adicionar outro, use o painel administrativo.',
    );
  }
}

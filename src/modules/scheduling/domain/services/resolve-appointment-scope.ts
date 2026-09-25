import type { AuthenticatedUser } from '../../../identity';
import { AppointmentOutOfScopeError } from '../errors/appointment-out-of-scope.error';
import { ProfessionalUserMisconfiguredError } from '../errors/professional-user-misconfigured.error';

/**
 * Union discriminada, nao um `professionalId?: string | null` opcional —
 * de proposito. `PrismaAppointmentRepository.listAppointments` exige este
 * tipo como parametro OBRIGATORIO, sem default: nao existe jeito de
 * escrever uma chamada nova pra esse metodo sem decidir explicitamente
 * entre "todas as agendas" ou "so a de um profissional". O tipo e o
 * mecanismo — nao um comentario pedindo pra lembrar.
 */
export type AppointmentScope = { kind: 'all' } | { kind: 'professional'; professionalId: string };

/**
 * Unica funcao que decide qual escopo vale pra um usuario autenticado —
 * RBAC da secao 5 (PROFISSIONAL: "apenas a propria agenda... filtro
 * aplicado na query, nao no front"). Testada isolada (sem tocar banco) em
 * resolve-appointment-scope.spec.ts, com foco especifico no ataque real:
 * PROFISSIONAL pedindo o professionalId de outra pessoa tem que receber de
 * volta o proprio escopo, nao o pedido — a query string nunca decide
 * sozinha.
 */
export function resolveAppointmentScope(
  user: AuthenticatedUser,
  requestedProfessionalId?: string,
): AppointmentScope {
  if (user.role === 'PROFISSIONAL') {
    if (!user.professionalId) {
      throw new ProfessionalUserMisconfiguredError(user.id);
    }
    // Ignora requestedProfessionalId de proposito, mesmo se vier preenchido
    // com outro id — um PROFISSIONAL nunca escolhe a propria agenda pela
    // query string, sempre a que esta vinculada ao User.
    return { kind: 'professional', professionalId: user.professionalId };
  }

  if (requestedProfessionalId) {
    return { kind: 'professional', professionalId: requestedProfessionalId };
  }

  return { kind: 'all' };
}

/** Checagem de posse pra ação sobre UMA consulta especifica (cancelar/remarcar), mesmo escopo do list. */
export function assertAppointmentInScope(
  scope: AppointmentScope,
  appointment: { professionalId: string },
): void {
  if (scope.kind === 'professional' && appointment.professionalId !== scope.professionalId) {
    throw new AppointmentOutOfScopeError();
  }
}

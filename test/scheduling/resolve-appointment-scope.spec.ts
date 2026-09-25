import { describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '../../src/modules/identity';
import { AppointmentOutOfScopeError } from '../../src/modules/scheduling/domain/errors/appointment-out-of-scope.error';
import { ProfessionalUserMisconfiguredError } from '../../src/modules/scheduling/domain/errors/professional-user-misconfigured.error';
import {
  assertAppointmentInScope,
  resolveAppointmentScope,
} from '../../src/modules/scheduling/domain/services/resolve-appointment-scope';

function user(overrides: Partial<AuthenticatedUser>): AuthenticatedUser {
  return {
    id: 'user-1',
    name: 'Teste',
    email: 'teste@clinica.test',
    role: 'ADMIN',
    professionalId: null,
    ...overrides,
  };
}

describe('resolveAppointmentScope', () => {
  it('ADMIN sem filtro pedido enxerga todas as agendas', () => {
    const scope = resolveAppointmentScope(user({ role: 'ADMIN' }));
    expect(scope).toEqual({ kind: 'all' });
  });

  it('RECEPCAO sem filtro pedido enxerga todas as agendas', () => {
    const scope = resolveAppointmentScope(user({ role: 'RECEPCAO' }));
    expect(scope).toEqual({ kind: 'all' });
  });

  it('ADMIN filtrando por um professionalId especifico recebe esse escopo', () => {
    const scope = resolveAppointmentScope(user({ role: 'ADMIN' }), 'prof-77');
    expect(scope).toEqual({ kind: 'professional', professionalId: 'prof-77' });
  });

  it('PROFISSIONAL sem pedir filtro nenhum recebe o proprio escopo', () => {
    const scope = resolveAppointmentScope(user({ role: 'PROFISSIONAL', professionalId: 'prof-eu' }));
    expect(scope).toEqual({ kind: 'professional', professionalId: 'prof-eu' });
  });

  /**
   * O TESTE que importa de verdade (pedido explicito do usuario): um
   * PROFISSIONAL tentando ver a agenda de outro so trocando o parametro da
   * URL/query nao pode conseguir. A funcao tem que IGNORAR o que foi
   * pedido e devolver sempre o escopo do proprio usuario autenticado.
   */
  it('PROFISSIONAL pedindo o professionalId de OUTRA pessoa recebe de volta o proprio escopo, nao o pedido', () => {
    const scope = resolveAppointmentScope(
      user({ role: 'PROFISSIONAL', professionalId: 'prof-eu' }),
      'prof-de-outro-profissional',
    );
    expect(scope).toEqual({ kind: 'professional', professionalId: 'prof-eu' });
  });

  it('PROFISSIONAL sem professionalId vinculado (conta mal cadastrada) recusa explicitamente, nao degrada em silencio', () => {
    expect(() => resolveAppointmentScope(user({ role: 'PROFISSIONAL', professionalId: null }))).toThrow(
      ProfessionalUserMisconfiguredError,
    );
  });
});

describe('assertAppointmentInScope', () => {
  it('escopo "all" nunca barra nenhuma consulta', () => {
    expect(() => assertAppointmentInScope({ kind: 'all' }, { professionalId: 'qualquer' })).not.toThrow();
  });

  it('escopo de profissional permite consulta da propria agenda', () => {
    expect(() =>
      assertAppointmentInScope({ kind: 'professional', professionalId: 'prof-eu' }, { professionalId: 'prof-eu' }),
    ).not.toThrow();
  });

  it('escopo de profissional barra consulta de agenda alheia — o ataque real que RN da secao 5 pede pra fechar', () => {
    expect(() =>
      assertAppointmentInScope(
        { kind: 'professional', professionalId: 'prof-eu' },
        { professionalId: 'prof-de-outro' },
      ),
    ).toThrow(AppointmentOutOfScopeError);
  });
});

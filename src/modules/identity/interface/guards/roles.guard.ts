import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';

/**
 * Sem @Roles(...) na rota = qualquer papel autenticado passa (rotas "todos"
 * do contrato da secao 5, ex.: GET /api/admin/appointments). Precisa rodar
 * DEPOIS do SessionGuard — le req.user.role, nao valida sessao.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    if (!request.user || !requiredRoles.includes(request.user.role)) {
      throw new ForbiddenException('Voce nao tem permissao para acessar este recurso.');
    }
    return true;
  }
}

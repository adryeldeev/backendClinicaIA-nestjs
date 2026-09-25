import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../../../../shared/config/env.schema';
import { CLOCK, Clock } from '../../../../shared/kernel/clock';
import { hashSessionToken } from '../../application/login.use-case';
import { SessionExpiredError } from '../../domain/errors/session-expired.error';
import { PrismaSessionRepository } from '../../infrastructure/prisma-session.repository';

/**
 * Cookie assinado (cookie-parser + SESSION_SECRET, ver main.ts) — adulterado
 * vira `false` em req.signedCookies, tratado igual a "sem cookie". O valor
 * em si e um token opaco; o banco so guarda o hash (nunca o token cru).
 *
 * Revalida o usuario a CADA requisicao, nao confia no que foi lido no
 * login: `findActiveByTokenHash` faz join com `User` e traz a linha atual
 * do banco (Prisma nao cacheia entre requests), entao troca de papel ja
 * vale na proxima chamada sem precisar de logout/login. `active` PRECISA
 * ser checado aqui tambem, explicitamente — o join sozinho so garante dado
 * fresco, nao decide nada sozinho. Sem essa checagem, um usuario
 * desativado continuaria autenticado ate a sessao expirar por tempo
 * (ate SESSION_TTL_HOURS, 12h por padrao) mesmo tendo sido desativado
 * agora mesmo.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: PrismaSessionRepository,
    private readonly config: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const cookieName = this.config.get('SESSION_COOKIE_NAME', { infer: true });
    const token = request.signedCookies?.[cookieName];

    if (!token || typeof token !== 'string') {
      throw new SessionExpiredError();
    }

    const session = await this.sessions.findActiveByTokenHash(hashSessionToken(token), this.clock.now());
    if (!session || !session.user.active) {
      throw new SessionExpiredError();
    }

    request.user = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
      professionalId: session.user.professionalId,
    };
    return true;
  }
}

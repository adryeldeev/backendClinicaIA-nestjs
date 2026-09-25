import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Redis } from 'ioredis';
import type { Env } from '../../../../shared/config/env.schema';
import { REDIS_CLIENT } from '../../../../shared/queue/redis-client.provider';
import { loginRateLimitKey, parseWindowSeconds } from '../../application/login-rate-limit-policy';
import { LoginRateLimitedError } from '../../domain/errors/login-rate-limited.error';

/**
 * SEC-08: 5 tentativas / 15 min / IP+e-mail. So LE o contador — nunca
 * incrementa. Achado do usuario apos o incidente de 2026-09-23: um guard
 * roda em CanActivate, antes do handler, entao nao tem como saber se a
 * tentativa vai dar certo ou nao. Incrementar aqui (como era antes) contava
 * login bem-sucedido como se fosse ataque. Quem incrementa e o LoginUseCase,
 * unico lugar que ve o desfecho real.
 */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = request.ip ?? 'unknown';
    const email = typeof request.body?.email === 'string' ? request.body.email : '';
    const { limit } = parseWindowSeconds(this.config.get('LOGIN_RATE_LIMIT', { infer: true }));

    const key = loginRateLimitKey(ip, email);
    const attempts = Number((await this.redis.get(key)) ?? 0);

    if (attempts >= limit) {
      throw new LoginRateLimitedError();
    }
    return true;
  }
}

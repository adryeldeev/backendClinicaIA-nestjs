import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import type { Redis } from 'ioredis';
import { createHash, randomBytes } from 'node:crypto';
import type { Env } from '../../../shared/config/env.schema';
import { CLOCK, Clock } from '../../../shared/kernel/clock';
import { REDIS_CLIENT } from '../../../shared/queue/redis-client.provider';
import { InvalidCredentialsError } from '../domain/errors/invalid-credentials.error';
import { PrismaSessionRepository } from '../infrastructure/prisma-session.repository';
import { PrismaUserRepository } from '../infrastructure/prisma-user.repository';
import { loginRateLimitKey, parseWindowSeconds } from './login-rate-limit-policy';

export interface LoginInput {
  email: string;
  password: string;
  ip: string | null;
  userAgent: string | null;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  user: { id: string; name: string; email: string; role: string; professionalId: string | null };
}

const HOUR_MS = 60 * 60 * 1000;

/** SHA-256 e suficiente aqui: e um lookup key, nao a senha em si (essa e argon2id). */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class LoginUseCase {
  constructor(
    private readonly users: PrismaUserRepository,
    private readonly sessions: PrismaSessionRepository,
    private readonly config: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * SEC-08: unico lugar que MUTA o contador de rate limit — o guard so le
   * (ver LoginRateLimitGuard). So incrementa em falha de verdade; login
   * certo nunca conta contra o limite (achado do usuario apos o incidente
   * de 2026-09-23: contar sucesso esgotava a janela do front so testando).
   */
  private async recordLoginFailure(ip: string, email: string): Promise<void> {
    const { windowSeconds } = parseWindowSeconds(this.config.get('LOGIN_RATE_LIMIT', { infer: true }));
    const key = loginRateLimitKey(ip, email);
    const attempts = await this.redis.incr(key);
    if (attempts === 1) {
      await this.redis.expire(key, windowSeconds);
    }
  }

  private async resetLoginFailures(ip: string, email: string): Promise<void> {
    await this.redis.del(loginRateLimitKey(ip, email));
  }

  async execute(input: LoginInput): Promise<LoginResult> {
    const ip = input.ip ?? 'unknown';
    const user = await this.users.findByEmail(input.email);
    if (!user || !user.active) {
      // Mesmo custo de tempo de um argon2.verify de verdade, pra nao vazar
      // por timing se o email existe ou nao.
      await argon2.hash('dummy-password-para-custo-constante');
      await this.recordLoginFailure(ip, input.email);
      throw new InvalidCredentialsError();
    }

    const passwordMatches = await argon2.verify(user.passwordHash, input.password);
    if (!passwordMatches) {
      await this.recordLoginFailure(ip, input.email);
      throw new InvalidCredentialsError();
    }

    await this.resetLoginFailures(ip, input.email);

    const now = this.clock.now();
    const token = randomBytes(32).toString('hex');
    const ttlHours = this.config.get('SESSION_TTL_HOURS', { infer: true });
    const expiresAt = new Date(now.getTime() + ttlHours * HOUR_MS);

    await this.sessions.create({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await this.users.markLoggedIn(user.id, now);

    return {
      token,
      expiresAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        professionalId: user.professionalId,
      },
    };
  }
}

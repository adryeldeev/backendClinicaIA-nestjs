import type { TestingModule } from '@nestjs/testing';
import { REDIS_CLIENT } from '../../src/shared/queue/redis-client.provider';
import type { Redis } from 'ioredis';

/**
 * O contador de rate limit de login (LoginRateLimitGuard) e por IP, com
 * janela de 15min, no MESMO Redis que persiste entre arquivos de teste
 * (fileParallelism:false, mas sem reset entre eles). Sem isso, chamadas a
 * /login de arquivos anteriores (login.e2e-spec, roles-guard.e2e-spec)
 * vazam pro contador e podem derrubar 429 em teste que nao e sobre rate
 * limit nenhum — supertest sempre bate do mesmo IP de loopback.
 */
export async function clearLoginRateLimit(moduleRef: TestingModule): Promise<void> {
  const redis = moduleRef.get<Redis>(REDIS_CLIENT);
  const keys = await redis.keys('login-rate-limit:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

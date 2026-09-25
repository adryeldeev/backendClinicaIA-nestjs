import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.schema';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Conexao raw pra uso fora do BullMQ (ex.: contador de rate limit em
 * identity) — a conexao do BullModule e gerenciada internamente por ele e
 * nao e exposta pra uso geral. Mesma REDIS_URL, cliente separado.
 *
 * maxRetriesPerRequest: null pelo mesmo motivo do bullmq.module.ts — sem
 * isso, o ioredis tenta re-tentar comando durante o disconnect() do
 * shutdown do app e gera "Connection is closed" como unhandled rejection
 * (visto de verdade rodando a suite completa apos adicionar este cliente).
 */
export const redisClientProvider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): Redis => {
    return new Redis(config.get('REDIS_URL', { infer: true }), { maxRetriesPerRequest: null });
  },
};

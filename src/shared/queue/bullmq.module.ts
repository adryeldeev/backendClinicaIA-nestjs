import { BullModule } from '@nestjs/bullmq';
import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { Env } from '../config/env.schema';
import { REDIS_CLIENT, redisClientProvider } from './redis-client.provider';
import {
  APPOINTMENT_REMINDER_QUEUE,
  CONVERSATION_PURGE_QUEUE,
  INBOUND_MESSAGES_QUEUE,
  KNOWLEDGE_REINDEX_QUEUE,
  OUTBOX_QUEUE,
  REPROCESS_STUCK_TURNS_QUEUE,
  SCHEDULING_MAINTENANCE_QUEUE,
} from './queue.tokens';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const redisUrl = new URL(config.get('REDIS_URL', { infer: true }));
        // pathname vem como "/1" (ou "" na raiz) — index do DB logico do
        // Redis (SELECT). Achado ao isolar a suite de teste (SPEC.md §4):
        // essa reconstrucao manual do host/port/password IGNORAVA o
        // pathname por completo, entao setar REDIS_URL=.../1 isolava o
        // cliente raw (redis-client.provider.ts, que usa `new Redis(url)`
        // e parseia certo) mas NAO as filas do BullMQ — elas continuavam
        // batendo no DB 0 de qualquer jeito, exatamente o vazamento que
        // causou os dois incidentes de 2026-09-23.
        const dbIndex = redisUrl.pathname.replace(/^\//, '');
        return {
          connection: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port || 6379),
            password: redisUrl.password || undefined,
            db: dbIndex ? Number(dbIndex) : undefined,
            // BullMQ exige isso explicitamente ao fornecer opcoes de conexao
            // customizadas — sem isso, o ioredis tenta re-tentar comandos
            // durante o shutdown do Worker e gera "Connection is closed".
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: INBOUND_MESSAGES_QUEUE },
      { name: OUTBOX_QUEUE },
      { name: SCHEDULING_MAINTENANCE_QUEUE },
      { name: APPOINTMENT_REMINDER_QUEUE },
      { name: CONVERSATION_PURGE_QUEUE },
      { name: REPROCESS_STUCK_TURNS_QUEUE },
      { name: KNOWLEDGE_REINDEX_QUEUE },
    ),
  ],
  providers: [redisClientProvider],
  exports: [BullModule, redisClientProvider],
})
export class QueueModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  onModuleDestroy(): void {
    // disconnect() (nao quit()) e sincrono e nao espera resposta do
    // servidor — evita o mesmo tipo de travamento no shutdown que o BullMQ
    // ja teve com essa conexao (comentario acima, maxRetriesPerRequest).
    this.redis.disconnect();
  }
}

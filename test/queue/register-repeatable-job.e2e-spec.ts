import 'reflect-metadata';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateEnv } from '../../src/shared/config/env.schema';
import { registerRepeatableJob } from '../../src/shared/queue/register-repeatable-job';
import { TEST_REDIS_URL } from '../support/test-env';

const TEST_QUEUE_NAME = 'test-register-repeatable-job';
const TEST_JOB_ID = 'test-repeatable-tick';

/**
 * Integracao com Redis REAL de proposito, nao BullMQ mockado (achado do
 * usuario apos o incidente de 2026-09-23, ver CLAUDE.md): o bug esta no
 * comportamento do BullMQ com ocorrencia vencida represada entre
 * reinicios do app, nao em logica desta aplicacao — um mock nao provaria
 * nada sobre isso. Fila dedicada (`test-register-repeatable-job`),
 * isolada das filas reais de producao.
 */
describe('registerRepeatableJob — integracao com Redis real (achado do incidente de 2026-09-23)', () => {
  let moduleRef: TestingModule;
  let queue: Queue;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        BullModule.forRootAsync({
          useFactory: () => {
            const redisUrl = new URL(TEST_REDIS_URL);
            const dbIndex = redisUrl.pathname.replace(/^\//, '');
            return {
              connection: {
                host: redisUrl.hostname,
                port: Number(redisUrl.port || 6379),
                db: dbIndex ? Number(dbIndex) : undefined,
                maxRetriesPerRequest: null,
              },
            };
          },
        }),
        BullModule.registerQueue({ name: TEST_QUEUE_NAME }),
      ],
    }).compile();

    queue = moduleRef.get(getQueueToken(TEST_QUEUE_NAME));
  });

  afterAll(async () => {
    const remaining = await queue.getRepeatableJobs();
    for (const repeatable of remaining) {
      await queue.removeRepeatableByKey(repeatable.key);
    }
    // moduleRef.close() sozinho, sem createNestApplication()+init(), nem
    // sempre fecha a conexao ioredis do BullMQ de verdade — fecha a
    // Queue explicitamente primeiro pra nao deixar conexao orfa gerando
    // "Connection is closed" mais tarde, em outro arquivo (achado real,
    // nao hipotetico: apareceu na suite completa antes deste fix).
    await queue.close();
    await moduleRef.close();
  });

  it('ocorrencia represada (vencida, nunca consumida por nenhum worker) e removida antes de reagendar — nunca dispara sozinha', async () => {
    const shortIntervalMs = 200;

    // Simula o boot ANTERIOR: registra um repeatable de intervalo curto
    // DIRETO via queue.add (sem passar pelo helper), igual o codigo antigo
    // fazia. Nenhum Worker conectado nesta fila em nenhum momento do
    // teste — exatamente "o app caiu antes de processar".
    await queue.add(TEST_JOB_ID, {}, { repeat: { every: shortIntervalMs }, jobId: TEST_JOB_ID });

    // Espera o intervalo passar DE VERDADE, sem ninguem consumir — a
    // mesma janela em que o app real ficou fora do ar no incidente.
    await new Promise((resolve) => setTimeout(resolve, shortIntervalMs + 150));

    const beforeFix = await queue.getRepeatableJobs();
    expect(beforeFix).toHaveLength(1);
    expect(beforeFix[0].next).toBeLessThan(Date.now()); // vencida de verdade, medido, nao suposto

    // O FIX: registra de novo, agora pelo helper.
    await registerRepeatableJob(queue, TEST_JOB_ID, 60_000);

    const afterFix = await queue.getRepeatableJobs();
    expect(afterFix).toHaveLength(1);
    expect(afterFix[0].next).toBeGreaterThan(Date.now()); // nunca mais vencida

    // O PONTO CENTRAL: nada foi executado. Sem isso, mesmo com o
    // scheduler corrigido, uma ocorrencia que ja tivesse virado job
    // ativo/completo antes do fix teria "vazado" um efeito colateral.
    const counts = await queue.getJobCounts('completed', 'active', 'waiting');
    expect(counts.completed).toBe(0);
    expect(counts.active).toBe(0);
    expect(counts.waiting).toBe(0);
  });
});

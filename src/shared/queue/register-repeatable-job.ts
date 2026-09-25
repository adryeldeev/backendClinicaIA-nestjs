import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

const logger = new Logger('registerRepeatableJob');

/**
 * Unico ponto do projeto que registra um repeatable no BullMQ — ver
 * scripts/check-repeatable-registration.ts (trava que falha se a opcao
 * `repeat` aparecer em qualquer outro arquivo). Sempre remove qualquer
 * repeatable (config + ocorrencia pendente) ja existente NESTA fila
 * antes de adicionar o novo.
 *
 * Achado real (incidente de 2026-09-23, ver CLAUDE.md — "Armadilhas ja
 * encontradas"): uma chamada isolada de `.add({repeat:{every}})` sempre
 * calcula a proxima ocorrencia no futuro, a partir do `now` daquele boot
 * — isso NUNCA foi "repeatable dispara imediato ao registrar". O bug de
 * verdade e outro: cada boot cria a SUA PROPRIA ocorrencia agendada sem
 * apagar a do boot anterior. Se o app fica fora do ar por mais tempo que
 * o `every`, essa ocorrencia antiga fica represada no Redis — vencida,
 * mas ninguem a consome enquanto nao ha worker — e dispara na hora assim
 * que um worker finalmente conecta, nao importa ha quanto tempo esta
 * vencida. Remover TUDO que ja existe antes de registrar de novo garante
 * que a unica ocorrencia pendente depois de cada boot é sempre calculada
 * a partir do `now` REAL daquele boot, nunca herdada de um boot anterior.
 */
export async function registerRepeatableJob(queue: Queue, jobId: string, everyMs: number): Promise<void> {
  const existing = await queue.getRepeatableJobs();
  const now = Date.now();

  for (const repeatable of existing) {
    await queue.removeRepeatableByKey(repeatable.key);
    if (repeatable.next !== undefined && repeatable.next < now) {
      logger.warn(
        `Repeatable '${jobId}' (fila '${queue.name}') tinha ocorrencia atrasada represada ` +
          `(vencida em ${new Date(repeatable.next).toISOString()}) — removida antes de reagendar. ` +
          'O app provavelmente ficou fora do ar por mais tempo que o intervalo configurado.',
      );
    }
  }

  await queue.add(jobId, {}, { repeat: { every: everyMs }, jobId });
}

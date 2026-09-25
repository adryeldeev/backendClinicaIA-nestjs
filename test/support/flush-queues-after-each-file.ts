import { Queue } from 'bullmq';
import { afterAll } from 'vitest';
import { APPOINTMENT_REMINDER_QUEUE, OUTBOX_QUEUE } from '../../src/shared/queue/queue.tokens';
import { TEST_REDIS_URL } from './test-env';

// "wait" e o estado de um job que nunca chegou a ser processado nem uma
// vez — achado concreto: arquivos que chamam job.process(...) na mao pra
// testar a logica (sem app.init(), sem Worker de verdade rodando —
// send-appointment-reminder.e2e-spec.ts, outbox-dispatch-disabled.e2e-spec.ts)
// enfileiram em OUTBOX_QUEUE via o mesmo caminho de producao, mas o job
// fica parado em "wait" pra sempre NAQUELE app (nenhum Worker daquele app
// vai busca-lo) — ate o worker de QUALQUER arquivo seguinte adotar.
const CLEAN_STATES = ['wait', 'delayed', 'failed'] as const;

// BullMQ (diferente de `new Redis(url)`) nao aceita string crua no tipo de
// `connection` — parseia igual bullmq.module.ts faz pro app real, incluindo
// o `db` do pathname (mesmo vazamento de DB dos incidentes de 2026-09-23
// se isso for esquecido aqui).
const redisUrl = new URL(TEST_REDIS_URL);
const dbIndex = redisUrl.pathname.replace(/^\//, '');
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  db: dbIndex ? Number(dbIndex) : undefined,
  maxRetriesPerRequest: null,
};

/**
 * `setupFiles` do vitest (nao `globalSetup`): roda em CADA arquivo de
 * teste, no mesmo contexto, entao o `afterAll` abaixo se registra junto
 * dos `afterAll` do proprio arquivo — dispara depois que todos os `it()`
 * daquele arquivo ja terminaram.
 *
 * Achado (2026-09-25): Redis nunca era limpo entre ARQUIVOS (so o Postgres,
 * uma vez, no inicio da suite inteira — ver global-setup.ts). Dois
 * mecanismos DIFERENTES deixam job orfao em OUTBOX_QUEUE, e os dois foram
 * reproduzidos de verdade (CI e local), nao so hipoteticos:
 *
 * 1. Arquivo que chama `job.process(...)` na mao pra testar logica, sem
 *    nunca dar `app.init()` (ex.: send-appointment-reminder.e2e-spec.ts,
 *    outbox-dispatch-disabled.e2e-spec.ts) — o `process()` em si enfileira
 *    em OUTBOX_QUEUE pelo caminho normal de producao, mas como o Worker
 *    daquele app nunca chega a existir (WorkerHost.onModuleInit nunca
 *    roda sem `.init()`), o job fica parado em "wait" pra sempre NAQUELE
 *    app.
 * 2. SendAppointmentReminderJob roda em TODO arquivo com AppModule
 *    completo (nao so nos que testam mensageria) — se achar uma consulta
 *    CONFIRMED de OUTRO teste caindo por acaso na janela de 24h, enfileira
 *    um lembrete de verdade contra o adapter real.
 *
 * Em ambos os casos, o job (com backoff exponencial se falhar) sobrevive
 * ao fechamento do app que o criou e e "adotado" pelo Worker de QUALQUER
 * arquivo seguinte que esteja de pe quando ele for pego, usando o
 * MESSAGING_PORT daquele outro arquivo. Prova concreta: inflou o callCount
 * de test/outbox-retry-exhaustion.e2e-spec.ts de 5 pra 9 numa rodada de CI
 * (mecanismo 2) e pra 15 rodando so um punhado de arquivos localmente
 * (mecanismo 1, contra send-appointment-reminder.e2e-spec.ts).
 *
 * Escopo deliberadamente estreito: so as 2 filas envolvidas no incidente
 * (OUTBOX_QUEUE recebe o job problematico; APPOINTMENT_REMINDER_QUEUE e
 * quem cria o do mecanismo 2) — limpar as 7 filas + remover repetivel em
 * cada uma chegou a levar ~13s POR ARQUIVO (960s de "setup" na suite
 * inteira, e um timeout novo em outro teste por causa disso). `wait`
 * (mecanismo 1) + `delayed`+`failed` (mecanismo 2, job em retry) em 2
 * filas mantem o custo desprezivel por arquivo fechando as duas causas.
 *
 * `clean()` (nao `obliterate()`) de proposito: nunca mexe num job ATIVO,
 * entao e seguro mesmo que o `afterAll` do proprio arquivo (que fecha o
 * app) ainda nao tenha terminado.
 */
afterAll(async () => {
  const outbox = new Queue(OUTBOX_QUEUE, { connection });
  const reminder = new Queue(APPOINTMENT_REMINDER_QUEUE, { connection });

  try {
    await Promise.all(
      [outbox, reminder].map(async (queue) => {
        for (const state of CLEAN_STATES) {
          await queue.clean(0, 1000, state);
        }
      }),
    );
  } finally {
    await Promise.all([outbox.close(), reminder.close()]);
  }
});

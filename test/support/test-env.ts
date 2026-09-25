/**
 * Fonte unica dos valores de DATABASE_URL/REDIS_URL usados pela suite de
 * testes — importado tanto por vitest.config.ts (via `test.env`, aplicado
 * ANTES de qualquer arquivo de teste rodar) quanto por
 * test/support/global-setup.ts (que conecta direto via PrismaClient pra
 * truncar/re-semear). Um so lugar evita as duas pontas divergirem.
 *
 * Achado do usuario (dois incidentes em dois dias, 2026-09-23): suite e
 * aplicacao local compartilhavam o MESMO banco Postgres ("clinica") e o
 * MESMO Redis (DB logico 0) — nao Testcontainers, mas tambem nao precisa:
 * nome de banco dedicado + SELECT de DB no Redis ja isolam sem subir nada
 * efemero. Ver SPEC.md secao 4.
 */
export const TEST_DATABASE_URL = 'postgresql://postgres:postgres@localhost:55432/clinica_test';
export const TEST_REDIS_URL = 'redis://localhost:6379/1';

/**
 * `true` por padrao na suite inteira — diferente do `.env` de dev/producao
 * (padrao `false`). O risco que a flag existe pra evitar (chamar a
 * WhatsApp Cloud API real) ja nao existe em teste: todo arquivo que precisa
 * observar envio ja troca MESSAGING_PORT por FakeMessagingPort via
 * `.overrideProvider()` — gatear de novo aqui so tornaria DispatchOutboxJob
 * menos testado, sem adicionar seguranca nenhuma. So o teste especifico do
 * caminho desligado (`outbox-dispatch-disabled.e2e-spec.ts`) sobrescreve
 * pra "false" antes do proprio import do AppModule.
 */
export const TEST_OUTBOX_DISPATCH_ENABLED = 'true';

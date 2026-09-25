import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL, TEST_OUTBOX_DISPATCH_ENABLED, TEST_REDIS_URL } from './test/support/test-env';

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    // Aplicado em process.env ANTES de qualquer arquivo de teste (e antes
    // do ConfigModule.forRoot() de qualquer AppModule importado por eles)
    // — dotenv (usado por @nestjs/config internamente) nao sobrescreve
    // variavel ja presente em process.env por padrao, entao isso vence
    // sobre o .env de desenvolvimento sem precisar de um .env.test
    // duplicado. Ver test/support/test-env.ts e SPEC.md §4.
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      OUTBOX_DISPATCH_ENABLED: TEST_OUTBOX_DISPATCH_ENABLED,
    },
    // Roda UMA vez antes da suite inteira: zera o Postgres de teste e
    // re-semeia a massa base (ver comentario em test/support/global-setup.ts
    // pro porque — banco de teste nunca era limpo entre rodadas, e isso
    // e a causa raiz real de mais de uma classe de flakiness).
    globalSetup: ['./test/support/global-setup.ts'],
    // Roda em CADA arquivo (diferente de globalSetup, uma vez so pra suite
    // inteira) — ver comentario em flush-queues-after-each-file.ts pro
    // porque isso precisa ser por arquivo, nao por rodada.
    setupFiles: ['./test/support/flush-queues-after-each-file.ts'],
    testTimeout: 30000,
    // Default de 10s estourava esporadicamente no afterAll (app.close())
    // de specs e2e rodando perto de outras no mesmo arquivo de execucao —
    // nao e leak de recurso (isolado, cada spec fecha rapido), e o custo de
    // "collect" cresce com o numero de specs e2e completos no processo
    // (cada um sobe app Nest inteiro); com mais specs (identity, Fase 6),
    // esse custo passou a competir com o timeout padrao do hook.
    // 30000 ainda nao bastava: apareceu 3x sob carga (catalog-admin-controller,
    // manage-clinic-settings, appointments-admin-controller), sempre no
    // app.close() de suites e2e completas rodando perto de outras — padrao,
    // nao acaso. Em vez de override por arquivo a cada novo caso, o timeout
    // global subiu pra 90000 (mesmo valor ja usado pontualmente).
    hookTimeout: 90000,
    // Os specs *.e2e-spec.ts sobem app Nest completo (Postgres + Redis +
    // BullMQ workers reais) — rodar varios arquivos em paralelo gera
    // contencao de conexao e testes instaveis. Sao poucos testes, o custo
    // de rodar sequencial e baixo.
    fileParallelism: false,
  },
});

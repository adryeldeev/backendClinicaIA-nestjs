import { resolve } from 'path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { seedDatabase } from '../../prisma/seed';
import { TEST_DATABASE_URL } from './test-env';

/**
 * Roda UMA vez antes da suite inteira (vitest `globalSetup`, nao um
 * `beforeAll` por arquivo) — zera o Postgres de teste e re-semeia a massa
 * base, pra cada `npx vitest run` comecar de um estado conhecido.
 *
 * Causa raiz fechada aqui (3a aparicao da mesma divida de isolamento,
 * primeira vez levantada antes da Fase 2 e adiada porque Promise.allSettled
 * resolveu o caso de concorrencia da epoca): o Postgres de teste nunca era
 * limpo entre execucoes da suite. Fixtures que criam Message de paciente
 * numa conversa BOT sem marcar consumido (varios arquivos, nao so um)
 * ficavam la para sempre; depois de tempo real suficiente, RN-16
 * (ReprocessStuckTurnsJob, funcionando exatamente como deveria) varria
 * esse lixo acumulado e inflava contadores compartilhados de testes sem
 * nenhuma relacao (achado concreto: debounce-batching.e2e-spec.ts com
 * callCount variando 2 a 22 dependendo de quantas linhas orfas existiam
 * no banco no momento). Truncar tudo elimina a classe inteira — qualquer
 * teste futuro que dependa de contagem/listagem/varredura deixa de poder
 * ser contaminado por sobra de rodada anterior — sem mexer em codigo de
 * producao nem desativar o registro dos jobs repetiveis nos testes.
 *
 * Desde o achado do segundo incidente de 2026-09-23, este truncate/reseed
 * roda contra `clinica_test` (banco Postgres dedicado, migrado a parte —
 * ver SPEC.md secao 4), nunca mais contra o banco `clinica` de
 * desenvolvimento. Antes disso os dois DIVIDIAM o mesmo banco.
 *
 * Re-semear (nao so truncar) e necessario porque
 * test/support/with-ai-disabled.ts e os testes de RN-25 dependem de "a
 * clinica primaria" ja existir (findFirst/findFirstOrThrow) sem criar uma
 * — hoje isso so funciona por acidente (o banco nunca fica vazio). Reusa
 * a mesma massa de prisma/seed.ts (`seedDatabase`) em vez de duplicar.
 */
export default async function setup(): Promise<void> {
  config({ path: resolve(__dirname, '../../.env') });
  // Vitest `test.env` (vitest.config.ts) so se aplica dentro do contexto de
  // teste, nao necessariamente neste script de setup — sobrescrito aqui
  // tambem, explicito, pra garantir que o truncate/reseed nunca alcance o
  // banco de desenvolvimento por engano.
  process.env.DATABASE_URL = TEST_DATABASE_URL;

  const prisma = new PrismaClient();
  try {
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
    `;

    if (tables.length > 0) {
      const quotedNames = tables.map((table) => `"${table.tablename}"`).join(', ');
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quotedNames} RESTART IDENTITY CASCADE`);
    }

    await seedDatabase(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

import { PrismaClient } from '@prisma/client';
import { seedDatabase } from './seed';

/**
 * Entrypoint de CLI (`npm run prisma:seed` / `prisma db seed`) separado de
 * `seed.ts` de proposito: `seed.ts` so define e exporta `seedDatabase`, sem
 * nenhum efeito colateral ao ser importado — test/support/global-setup.ts
 * tambem importa `seedDatabase` de la, e um auto-exec no import (mesmo
 * atras de `require.main === module`) e ambiguo entre o loader do ts-node
 * (CLI) e o do vite-node (testes), risco desnecessario.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedDatabase(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

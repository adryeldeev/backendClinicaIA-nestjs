import { PrismaClient } from '@prisma/client';
import { seedTestConversations } from './seed-conversations';

/** Entrypoint de CLI (`npm run seed:conversations`) — mesmo padrao de separacao de run-seed.ts. */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedTestConversations(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

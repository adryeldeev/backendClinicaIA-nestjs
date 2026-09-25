import { PrismaClient } from '@prisma/client';
import { seedTestAppointments } from './seed-appointments';

/** Entrypoint de CLI (`npm run seed:appointments`) — mesmo padrao de separacao de run-seed.ts. */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedTestAppointments(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

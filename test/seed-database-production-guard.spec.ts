import { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it } from 'vitest';
import { seedDatabase } from '../prisma/seed';

/**
 * Achado do usuario (2026-09-25): seedDatabase() cria 3 usuarios com senha
 * FIXA e CONHECIDA — correto em dev, mas o codigo esta publico no GitHub,
 * entao a senha tambem esta. O risco real e alguem rodar `npm run seed`
 * apontando pra producao um dia e deixar 3 contas de acesso conhecido num
 * sistema com dado de saude. Mesma defesa do RETENTION_PURGE_ENABLED.
 */
describe('seedDatabase — recusa rodar em producao', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('NODE_ENV=production: aborta ANTES de tocar no banco, mensagem clara aponta pro caminho certo', async () => {
    process.env.NODE_ENV = 'production';
    // PrismaClient real, mas se o guard funcionar, a conexao nunca chega a
    // ser usada — nao precisa apontar pro banco de teste de verdade.
    const prisma = new PrismaClient();

    await expect(seedDatabase(prisma)).rejects.toThrow('npm run create-admin');

    await prisma.$disconnect();
  });
});

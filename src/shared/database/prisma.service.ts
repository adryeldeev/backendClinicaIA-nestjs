import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { mapPrismaError } from './map-prisma-error';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super();
    // Traducao de erro de infraestrutura pra erro de dominio, NUM LUGAR SO
    // (achado do usuario, regressao de 2026-09-24) — nenhum repositorio
    // precisa saber de codigo do Prisma. $use foi removido no Prisma 6 (so
    // $extends existe agora); $extends() devolve um objeto NOVO com os
    // mesmos delegates de model porem envolvidos, nao muta `this` sozinho.
    // Object.assign copia esses delegates envolvidos como propriedade
    // PROPRIA em `this` (sombreando os herdados do prototype de
    // PrismaClient) — mantem a MESMA instancia de PrismaService (identidade
    // preservada, onModuleInit/onModuleDestroy/isHealthy continuam no
    // prototype), diferente de `return this.$extends(...)` no construtor
    // (tambem funcionaria em JS puro, mas trocaria o objeto de verdade
    // devolvido por `new PrismaService()` por um sem o prototype de
    // PrismaService — os hooks de ciclo de vida do Nest silenciosamente
    // parariam de rodar, sem erro nenhum. Testado e descartado.).
    const extended = this.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query }) {
            try {
              return await query(args);
            } catch (error) {
              throw mapPrismaError(error);
            }
          },
        },
      },
    });
    Object.assign(this, extended);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error('Database health check failed', error as Error);
      return false;
    }
  }
}

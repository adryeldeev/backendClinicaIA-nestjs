import 'reflect-metadata';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../src/shared/database/database.module';

/**
 * EMBEDDING_DIMENSIONS (.env) e a coluna "embedding vector(768)" guardam o
 * mesmo numero em dois lugares sem checagem nenhuma — trocar de modelo de
 * embedding sem migration+reingestao trunca/rejeita vetor silenciosamente.
 * KnowledgeModule.onModuleInit falha alto e claro no boot se divergirem.
 *
 * `TestingModule.compile()` sozinho NAO dispara onModuleInit (achado nesta
 * tarefa) — so `app.init()` dispara os lifecycle hooks de verdade. Testar
 * isso com `expect(compile()).rejects...` quando compile() na verdade
 * RESOLVE (nunca rejeita) trava o processo: a falha da asserção tenta
 * descrever o valor resolvido, que é o `TestingModule` inteiro (grafo
 * circular gigante do container de DI) — e o processo estoura de memória
 * tentando serializar isso pra mensagem de erro. `app.init()` rejeita com
 * um Error simples, seguro de descrever.
 *
 * process.env precisa ser setado ANTES do import de qualquer coisa que
 * dependa de env.schema.ts — import ES e hoisted acima de qualquer
 * atribuicao no topo do arquivo (achado documentado no CLAUDE.md), entao
 * o import de KnowledgeModule/validateEnv e dinamico aqui, depois da
 * atribuicao.
 */
describe('KnowledgeModule — validacao de dimensao do embedding no boot', () => {
  it('EMBEDDING_DIMENSIONS diferente da coluna real falha o boot com mensagem clara', async () => {
    process.env.EMBEDDING_DIMENSIONS = '1536'; // coluna real e vector(768)

    const { KnowledgeModule } = await import('../../src/modules/knowledge');
    const { validateEnv } = await import('../../src/shared/config/env.schema');

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), DatabaseModule, KnowledgeModule],
    }).compile();

    const app = moduleRef.createNestApplication();
    try {
      await expect(app.init()).rejects.toThrow(/EMBEDDING_DIMENSIONS.*768/);
    } finally {
      delete process.env.EMBEDDING_DIMENSIONS;
      await app.close();
    }
  });
});

import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { Job } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { EMBEDDING_PORT, type EmbeddingPort } from '../../src/modules/knowledge';
import { ReindexKnowledgeDocumentJob } from '../../src/modules/knowledge/application/reindex-knowledge-document.job';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { clearLoginRateLimit } from '../support/clear-login-rate-limit';
import { configureTestApp } from '../support/configure-test-app';
import { uniquePhone } from '../support/unique-phone';
import { waitFor } from '../support/wait-for';
import { waitForQueueWorkersReady } from '../support/wait-for-queues-ready';

/**
 * EmbeddingPort controlavel pelo teste: `hold()` faz o proximo `embed()`
 * pendurar ate `release()` ser chamado (prova a janela da troca atomica
 * sem depender de timing real), e `throwOnNextCall()` simula o provedor
 * falhando (prova que a versao anterior nunca sai do ar mesmo com o job
 * esgotando as tentativas).
 */
class ControllableEmbeddingPort implements EmbeddingPort {
  private gate: Promise<void> | null = null;
  private releaseGateFn: (() => void) | null = null;
  private waiters: Array<() => void> = [];
  private calledCount = 0;
  private shouldThrow = false;

  async embed(): Promise<number[]> {
    this.calledCount++;
    const currentWaiters = this.waiters;
    this.waiters = [];
    currentWaiters.forEach((resolve) => resolve());

    if (this.shouldThrow) {
      throw new Error('embedding_failed: simulado para teste de troca atomica');
    }
    if (this.gate) {
      await this.gate;
    }
    return new Array(768).fill(0).map((_, i) => (i === 0 ? 1 : 0));
  }

  hold(): void {
    this.gate = new Promise((resolve) => {
      this.releaseGateFn = resolve;
    });
  }

  release(): void {
    this.releaseGateFn?.();
    this.gate = null;
  }

  throwOnNextCall(value: boolean): void {
    this.shouldThrow = value;
  }

  waitUntilCalledAtLeast(target: number): Promise<void> {
    if (this.calledCount >= target) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  get callCount(): number {
    return this.calledCount;
  }
}

describe('Troca atomica de versao do KnowledgeDocument (Etapa 5, e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let embeddingPort: ControllableEmbeddingPort;
  let adminCookie: string;

  beforeAll(async () => {
    embeddingPort = new ControllableEmbeddingPort();

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMBEDDING_PORT)
      .useValue(embeddingPort)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    configureTestApp(app);
    prisma = moduleRef.get(PrismaService);
    await app.init();
    await waitForQueueWorkersReady(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await clearLoginRateLimit(moduleRef);
    const email = `admin-knowledge-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Admin Knowledge', role: 'ADMIN' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    adminCookie = loginResponse.headers['set-cookie'][0];
  });

  it('reindexacao em andamento: a versao anterior continua active e servindo ate a nova estar completa', async () => {
    const sourceRef = `politica-atraso-${uniquePhone()}`;

    const createResponse = await request(app.getHttpServer())
      .post('/api/admin/knowledge')
      .set('Cookie', adminCookie)
      .send({ title: 'Politica de atraso', category: 'geral', sourceRef, content: 'Versao original da politica de atraso.' });
    expect(createResponse.status).toBe(202);

    const originalId = createResponse.body.documentId as string;
    await waitFor(async () => {
      const doc = await prisma.knowledgeDocument.findUnique({ where: { id: originalId } });
      return doc?.status === 'READY' ? doc : undefined;
    });

    // Segura o proximo embed() — a reindexacao vai travar no meio do
    // processamento, exatamente a janela que o achado do usuario descreveu.
    // Baseline explicito: o embeddingPort e compartilhado com a criacao do
    // documento original (chamadas acima), entao "esperar 1 chamada" tem
    // que ser relativo a AGORA, nao ao total acumulado desde o inicio do teste.
    const callsBeforeReindex = embeddingPort.callCount;
    embeddingPort.hold();

    try {
      const reindexResponse = await request(app.getHttpServer())
        .post(`/api/admin/knowledge/${originalId}/reindex`)
        .set('Cookie', adminCookie)
        .send();
      expect(reindexResponse.status).toBe(202);
      const draftId = reindexResponse.body.documentId as string;
      expect(draftId).not.toBe(originalId);

      // Job pegou o rascunho e chamou embed() pelo menos uma vez — esta
      // preso na janela agora.
      await embeddingPort.waitUntilCalledAtLeast(callsBeforeReindex + 1);

      // O PONTO CENTRAL: enquanto o job esta preso, a versao ORIGINAL
      // continua active — e a flag que search-by-vector/search-by-text
      // filtram (`WHERE kd.active = true`), entao isso e exatamente o que
      // garante que uma pergunta de paciente nesse instante ainda encontra
      // o documento. A versao nova continua active:false, nunca visivel.
      const originalDuringReindex = await prisma.knowledgeDocument.findUnique({ where: { id: originalId } });
      const draftDuringReindex = await prisma.knowledgeDocument.findUnique({ where: { id: draftId } });
      expect(originalDuringReindex?.active).toBe(true);
      expect(draftDuringReindex?.active).toBe(false);
      expect(draftDuringReindex?.status).toBe('RUNNING');

      embeddingPort.release();

      await waitFor(async () => {
        const doc = await prisma.knowledgeDocument.findUnique({ where: { id: draftId } });
        return doc?.status === 'READY' ? doc : undefined;
      });

      const originalAfter = await prisma.knowledgeDocument.findUnique({ where: { id: originalId } });
      const draftAfter = await prisma.knowledgeDocument.findUnique({ where: { id: draftId } });
      expect(originalAfter?.active).toBe(false);
      expect(draftAfter?.active).toBe(true);
      expect(draftAfter?.status).toBe('READY');
    } finally {
      // Sem isso, uma asserção que falhar no meio deixa o gate preso pra
      // sempre — qualquer embed() de um teste seguinte no mesmo arquivo
      // (mesma instancia compartilhada) travaria esperando um release()
      // que nunca chega.
      embeddingPort.release();
    }
  });

  it('job esgota as tentativas: versao anterior nunca sai do ar, rascunho fica FAILED com o erro registrado', async () => {
    const sourceRef = `preparo-exame-${uniquePhone()}`;

    const createResponse = await request(app.getHttpServer())
      .post('/api/admin/knowledge')
      .set('Cookie', adminCookie)
      .send({ title: 'Preparo de exame', category: 'preparo_exame', sourceRef, content: 'Jejum de 8 horas antes do exame.' });
    const originalId = createResponse.body.documentId as string;
    await waitFor(async () => {
      const doc = await prisma.knowledgeDocument.findUnique({ where: { id: originalId } });
      return doc?.status === 'READY' ? doc : undefined;
    });

    const draft = await prisma.knowledgeDocument.create({
      data: {
        title: 'Preparo de exame (atualizado)',
        category: 'preparo_exame',
        sourceRef,
        content: 'Jejum de 12 horas antes do exame.',
        version: 2,
        active: false,
        status: 'PENDING',
      },
    });

    const reindexJob = moduleRef.get(ReindexKnowledgeDocumentJob);
    embeddingPort.throwOnNextCall(true);

    // Chama process() direto, simulando a ULTIMA tentativa (mesma
    // convencao de DispatchOutboxJob: attemptsMade+1 >= attempts) — sem
    // esperar o backoff exponencial real do BullMQ (5 tentativas reais
    // levariam ~30s de espera de verdade, dependencia de relogio que este
    // projeto ja rejeitou como padrao de teste).
    await expect(
      reindexJob.process({ data: { documentId: draft.id }, attemptsMade: 4, opts: { attempts: 5 } } as unknown as Job),
    ).rejects.toThrow();

    const originalAfter = await prisma.knowledgeDocument.findUnique({ where: { id: originalId } });
    const draftAfter = await prisma.knowledgeDocument.findUnique({ where: { id: draft.id } });

    expect(originalAfter?.active).toBe(true);
    expect(originalAfter?.status).toBe('READY');
    expect(draftAfter?.active).toBe(false);
    expect(draftAfter?.status).toBe('FAILED');
    expect(draftAfter?.errorMessage).toContain('embedding_failed');
  });
});

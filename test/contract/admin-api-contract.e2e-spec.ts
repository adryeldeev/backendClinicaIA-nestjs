import 'reflect-metadata';
import { Controller, Get, INestApplication, UseGuards, UseInterceptors } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { AuditInterceptor, SessionGuard } from '../../src/modules/identity';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { clearLoginRateLimit } from '../support/clear-login-rate-limit';
import { configureTestApp } from '../support/configure-test-app';
import { uniquePhone } from '../support/unique-phone';
import { waitForQueueWorkersReady } from '../support/wait-for-queues-ready';

/**
 * Teste de CONTRATO (achado do usuario, regressao real de 2026-09-24):
 * 198 testes verdes nao pegaram nem "GET /conversations sem limit responde
 * 400 com 'Expected number, received nan'" nem "id inexistente responde
 * 500 fora do envelope" — porque quem escreveu a rota escreveu o teste, e
 * sempre passou os parametros do jeito que o proprio codigo espera. Este
 * arquivo chama cada rota /api/admin/* exatamente como o FRONT chama:
 * parametros opcionais OMITIDOS, id inexistente, sem sessao. E o unico
 * teste escrito da perspectiva de quem consome a API, nao de quem a
 * escreveu.
 */

const NONEXISTENT_ID = '00000000-0000-0000-0000-000000000000';

/** Rotas /api/admin/* protegidas por sessao — usado pela secao "sem sessao". */
const PROTECTED_ROUTES: Array<{ method: 'get' | 'post' | 'put' | 'delete'; path: string }> = [
  { method: 'get', path: '/api/admin/auth/me' },
  { method: 'post', path: '/api/admin/auth/logout' },
  { method: 'get', path: `/api/admin/appointments?from=2026-01-01&to=2026-01-02` },
  { method: 'post', path: '/api/admin/appointments' },
  { method: 'post', path: `/api/admin/appointments/${NONEXISTENT_ID}/cancel` },
  { method: 'post', path: `/api/admin/appointments/${NONEXISTENT_ID}/reschedule` },
  { method: 'get', path: '/api/admin/availability' },
  { method: 'get', path: '/api/admin/conversations' },
  { method: 'get', path: `/api/admin/conversations/${NONEXISTENT_ID}` },
  { method: 'post', path: '/api/admin/conversations/search' },
  { method: 'post', path: `/api/admin/conversations/${NONEXISTENT_ID}/takeover` },
  { method: 'post', path: `/api/admin/conversations/${NONEXISTENT_ID}/messages` },
  { method: 'post', path: `/api/admin/conversations/${NONEXISTENT_ID}/release` },
  { method: 'post', path: '/api/admin/patients/search' },
  { method: 'get', path: '/api/admin/knowledge' },
  { method: 'post', path: '/api/admin/knowledge/test-search' },
  { method: 'get', path: `/api/admin/knowledge/${NONEXISTENT_ID}` },
  { method: 'post', path: '/api/admin/knowledge' },
  { method: 'put', path: `/api/admin/knowledge/${NONEXISTENT_ID}` },
  { method: 'post', path: `/api/admin/knowledge/${NONEXISTENT_ID}/reindex` },
  { method: 'get', path: '/api/admin/catalog/professionals' },
  { method: 'post', path: '/api/admin/catalog/professionals' },
  { method: 'put', path: `/api/admin/catalog/professionals/${NONEXISTENT_ID}` },
  { method: 'get', path: '/api/admin/catalog/procedures' },
  { method: 'post', path: '/api/admin/catalog/procedures' },
  { method: 'put', path: `/api/admin/catalog/procedures/${NONEXISTENT_ID}` },
  { method: 'get', path: `/api/admin/catalog/availability/rules?professionalId=${NONEXISTENT_ID}` },
  { method: 'post', path: '/api/admin/catalog/availability/rules' },
  { method: 'put', path: `/api/admin/catalog/availability/rules/${NONEXISTENT_ID}` },
  { method: 'delete', path: `/api/admin/catalog/availability/rules/${NONEXISTENT_ID}` },
  {
    method: 'get',
    path: `/api/admin/catalog/availability/exceptions?professionalId=${NONEXISTENT_ID}&from=2026-01-01&to=2026-01-02`,
  },
  { method: 'post', path: '/api/admin/catalog/availability/exceptions' },
  { method: 'delete', path: `/api/admin/catalog/availability/exceptions/${NONEXISTENT_ID}` },
  { method: 'get', path: '/api/admin/settings/ai-enabled' },
  { method: 'put', path: '/api/admin/settings/ai-enabled' },
  { method: 'get', path: '/api/admin/metrics' },
];

/** Rotas com :id — chamadas com um UUID valido mas inexistente, corpo minimo valido quando precisa. */
const ID_ROUTES: Array<{ method: 'get' | 'post' | 'put' | 'delete'; path: string; body?: Record<string, unknown> }> = [
  { method: 'post', path: `/api/admin/appointments/${NONEXISTENT_ID}/cancel`, body: { reason: 'teste' } },
  {
    method: 'post',
    path: `/api/admin/appointments/${NONEXISTENT_ID}/reschedule`,
    body: { newStartsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() },
  },
  { method: 'get', path: `/api/admin/conversations/${NONEXISTENT_ID}` },
  { method: 'post', path: `/api/admin/conversations/${NONEXISTENT_ID}/takeover` },
  { method: 'post', path: `/api/admin/conversations/${NONEXISTENT_ID}/release` },
  { method: 'post', path: `/api/admin/conversations/${NONEXISTENT_ID}/messages`, body: { body: 'oi' } },
  { method: 'get', path: `/api/admin/knowledge/${NONEXISTENT_ID}` },
  { method: 'put', path: `/api/admin/knowledge/${NONEXISTENT_ID}`, body: { title: 'Titulo novo' } },
  { method: 'post', path: `/api/admin/knowledge/${NONEXISTENT_ID}/reindex` },
  { method: 'put', path: `/api/admin/catalog/professionals/${NONEXISTENT_ID}`, body: {} },
  { method: 'put', path: `/api/admin/catalog/procedures/${NONEXISTENT_ID}`, body: {} },
  { method: 'put', path: `/api/admin/catalog/availability/rules/${NONEXISTENT_ID}`, body: {} },
  { method: 'delete', path: `/api/admin/catalog/availability/rules/${NONEXISTENT_ID}` },
  { method: 'delete', path: `/api/admin/catalog/availability/exceptions/${NONEXISTENT_ID}` },
];

/** Controller so-de-teste — prova o AllExceptionsFilter com uma excecao que NAO e DomainError nem HttpException. */
@Controller('api/admin/contract-test-unhandled')
class UnhandledExceptionTestController {
  @Get()
  @UseGuards(SessionGuard)
  @UseInterceptors(AuditInterceptor)
  throwRaw(): never {
    throw new Error('erro de programacao simulado — nunca deveria vazar detalhe pro cliente');
  }
}

function expectErrorEnvelope(body: unknown): asserts body is { error: { code: string; message: string } } {
  expect(body).toHaveProperty('error');
  const error = (body as { error?: unknown }).error;
  expect(error).toHaveProperty('code');
  expect(error).toHaveProperty('message');
  expect(typeof (error as { code: unknown }).code).toBe('string');
  expect(typeof (error as { message: unknown }).message).toBe('string');
  // O formato ANTIGO que vazava (achado do usuario, 2026-09-24) — nunca mais.
  expect(body).not.toHaveProperty('statusCode');
}

describe('Contrato /api/admin/* — chamado como o front chama (e2e)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let adminCookie: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [UnhandledExceptionTestController],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureTestApp(app);
    prisma = moduleRef.get(PrismaService);
    await app.init();
    await waitForQueueWorkersReady(moduleRef);
    await clearLoginRateLimit(moduleRef);

    const email = `admin-contract-${uniquePhone()}@clinica.test`;
    const password = 'senha-forte-123';
    await prisma.user.create({
      data: { email, passwordHash: await argon2.hash(password), name: 'Admin Contrato', role: 'ADMIN' },
    });
    const loginResponse = await request(app.getHttpServer()).post('/api/admin/auth/login').send({ email, password });
    adminCookie = loginResponse.headers['set-cookie'][0];
  });

  afterAll(async () => {
    await app.close();
  });

  describe('sem sessao — toda rota protegida responde 401 com o envelope padrao, nunca 500/403 cru', () => {
    for (const route of PROTECTED_ROUTES) {
      it(`${route.method.toUpperCase()} ${route.path}`, async () => {
        const response = await request(app.getHttpServer())[route.method](route.path).send({});
        expect(response.status).toBe(401);
        expectErrorEnvelope(response.body);
      });
    }
  });

  describe('parametros opcionais omitidos — o caso real que quebrou (limit de /conversations)', () => {
    it('GET /conversations sem NENHUM query param: nao e 400/500, usa limit=50 do servidor', async () => {
      const response = await request(app.getHttpServer()).get('/api/admin/conversations').set('Cookie', adminCookie);
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.items)).toBe(true);
    });

    it('GET /conversations?status=BOT sem limit: mesmo resultado, nunca "nan" na mensagem', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/admin/conversations?status=BOT')
        .set('Cookie', adminCookie);
      expect(response.status).toBe(200);
    });

    it('GET /metrics sem from/to: usa o mes corrente, nao quebra', async () => {
      const response = await request(app.getHttpServer()).get('/api/admin/metrics').set('Cookie', adminCookie);
      expect(response.status).toBe(200);
    });

    it('GET /appointments sem professionalId (unico opcional): funciona normal', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/admin/appointments?from=2026-01-01&to=2026-01-02')
        .set('Cookie', adminCookie);
      expect(response.status).toBe(200);
    });

    it('limit acima do teto do servidor (100) e rejeitado com mensagem legivel, nunca "nan"', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/admin/conversations?limit=999')
        .set('Cookie', adminCookie);
      expect(response.status).toBe(400);
      expectErrorEnvelope(response.body);
      expect(response.body.error.message.toLowerCase()).not.toContain('nan');
      expect(response.body.error.message.toLowerCase()).not.toContain('expected');
    });
  });

  describe('id inexistente — toda rota com :id responde erro DENTRO do envelope, nunca 500 cru', () => {
    for (const route of ID_ROUTES) {
      it(`${route.method.toUpperCase()} ${route.path}`, async () => {
        const response = await request(app.getHttpServer())
          [route.method](route.path)
          .set('Cookie', adminCookie)
          .send(route.body ?? {});
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500); // NUNCA 500 pra id que so nao existe
        expectErrorEnvelope(response.body);
      });
    }
  });

  // Criterio de aceite novo (SPEC.md secao 16, pedido do usuario): excecao
  // nao tratada em QUALQUER rota ainda produz {error:{code,message}}. Prova
  // o mecanismo (AllExceptionsFilter) direto, com uma excecao que nao e
  // nem DomainError nem HttpException — o caso que escapava antes.
  it('excecao nao tratada (nem DomainError, nem HttpException) ainda produz o envelope, nunca {statusCode,message} cru', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/admin/contract-test-unhandled')
      .set('Cookie', adminCookie);

    expect(response.status).toBe(500);
    expectErrorEnvelope(response.body);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    // Nunca vaza detalhe interno (stack, mensagem crua do erro) pro cliente.
    expect(response.body.error.message).not.toContain('erro de programacao simulado');
  });
});

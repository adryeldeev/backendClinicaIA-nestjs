import 'reflect-metadata';
import { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { CreateFirstAdminUseCase } from '../../src/modules/identity';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { uniquePhone } from '../support/unique-phone';
import { waitForQueueWorkersReady } from '../support/wait-for-queues-ready';

/**
 * scripts/create-admin-user.ts (achado do usuario na revisao da Etapa 1:
 * sem isso, subir a API em producao nao tem nenhum caminho pra entrar no
 * painel) delega toda a regra de negocio pra CreateFirstAdminUseCase — CLI
 * so faz argv/prompt. Testado aqui contra o Postgres real.
 */
describe('CreateFirstAdminUseCase (e2e)', () => {
  let app: INestApplicationContext;
  let prisma: PrismaService;
  let useCase: CreateFirstAdminUseCase;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    prisma = moduleRef.get(PrismaService);
    useCase = moduleRef.get(CreateFirstAdminUseCase);
    await app.init();
    // Sem isso o app.close() no afterAll trava — os workers do BullMQ
    // (messaging, mesmo sem uso neste arquivo) precisam confirmar conexao
    // antes do encerramento, mesmo padrao de todo outro spec e2e do projeto.
    await waitForQueueWorkersReady(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  // Outros arquivos de teste de identity criam User com role ADMIN direto
  // via Prisma (login.e2e-spec.ts, roles-guard.e2e-spec.ts etc.) no MESMO
  // banco compartilhado, sem isolamento entre arquivos — e o proprio
  // primeiro teste deste arquivo cria um ADMIN de verdade. Sem limpar antes
  // de CADA teste (nao so uma vez no beforeAll), "nao existe nenhum ADMIN
  // ainda" so seria verdade por acidente de ordem de execucao.
  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { role: 'ADMIN' } });
  });

  it('cria o primeiro admin quando nao existe nenhum ADMIN ainda', async () => {
    const email = `bootstrap-${uniquePhone()}@clinica.test`;

    const result = await useCase.execute({ email, name: 'Primeiro Admin', password: 'senha-forte-123' });

    expect(result.email).toBe(email);
    const created = await prisma.user.findUniqueOrThrow({ where: { id: result.id } });
    expect(created.role).toBe('ADMIN');
    expect(created.active).toBe(true);
    expect(created.passwordHash).not.toBe('senha-forte-123'); // nunca em texto puro
  });

  it('recusa criar um segundo admin quando ja existe um ADMIN — nao vira porta dos fundos', async () => {
    const firstEmail = `bootstrap-${uniquePhone()}@clinica.test`;
    await useCase.execute({ email: firstEmail, name: 'Primeiro Admin', password: 'senha-forte-123' });

    const secondEmail = `bootstrap-${uniquePhone()}@clinica.test`;
    await expect(
      useCase.execute({ email: secondEmail, name: 'Segundo Admin', password: 'senha-forte-123' }),
    ).rejects.toMatchObject({ code: 'ADMIN_ALREADY_EXISTS' });

    const secondUser = await prisma.user.findUnique({ where: { email: secondEmail } });
    expect(secondUser).toBeNull();
  });

  it('recusa email ja cadastrado (caso nao haja admin ainda mas o email pertenca a outro papel)', async () => {
    const email = `recepcao-${uniquePhone()}@clinica.test`;
    await prisma.user.create({
      data: { email, name: 'Recepcao Existente', passwordHash: 'hash-qualquer', role: 'RECEPCAO' },
    });

    await expect(useCase.execute({ email, name: 'Tentando Ser Admin', password: 'senha-forte-123' })).rejects.toMatchObject(
      { code: 'EMAIL_ALREADY_REGISTERED' },
    );
  });

  it('rejeita senha curta antes de tocar o banco', async () => {
    const email = `curta-${uniquePhone()}@clinica.test`;

    await expect(useCase.execute({ email, name: 'Nome', password: '123' })).rejects.toThrow();

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });
});

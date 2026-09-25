/**
 * Bootstrap do primeiro usuario ADMIN (secao 5 da SPEC.md) — comitado, nao
 * descartavel. Sem isso, subir a API em producao nao tem nenhum caminho
 * pra entrar no painel administrativo.
 *
 * Uso:
 *   npm run create-admin -- --email admin@clinica.com --name "Nome Sobrenome" --password "senha-forte"
 *
 * Qualquer flag omitida e perguntada interativamente (senha sem eco no
 * terminal). So argv/prompt aqui — a regra de negocio (recusa se ja existe
 * ADMIN, hash da senha, etc.) mora em CreateFirstAdminUseCase, testado em
 * test/identity/create-first-admin.e2e-spec.ts.
 */
import * as readline from 'node:readline';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { CreateFirstAdminUseCase, IdentityModule } from '../src/modules/identity';
import { DomainError } from '../src/shared/kernel/domain-error';
import { validateEnv } from '../src/shared/config/env.schema';
import { DatabaseModule } from '../src/shared/database/database.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), DatabaseModule, IdentityModule],
})
class CreateAdminCliModule {}

interface ParsedArgs {
  email?: string;
  name?: string;
  password?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if (argv[i] === '--email') args.email = value;
    if (argv[i] === '--name') args.name = value;
    if (argv[i] === '--password') args.password = value;
  }
  return args;
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Sem eco no terminal — evita a senha aparecer na tela/no historico do terminal. */
function promptPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode?.(true);
    stdin.setEncoding('utf8');

    let password = '';
    const onData = (char: string): void => {
      if (char === '\n' || char === '\r' || char === '') {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(password);
        return;
      }
      if (char === '') {
        process.exit(1); // Ctrl+C
      }
      if (char === '') {
        password = password.slice(0, -1); // backspace
        return;
      }
      password += char;
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  const email = parsed.email ?? (await prompt('Email do admin: '));
  const name = parsed.name ?? (await prompt('Nome do admin: '));
  const password = parsed.password ?? (await promptPassword('Senha do admin: '));

  const app = await NestFactory.createApplicationContext(CreateAdminCliModule);
  try {
    const createFirstAdmin = app.get(CreateFirstAdminUseCase);
    const result = await createFirstAdmin.execute({ email, name, password });
    console.log(`Usuario ADMIN criado: ${result.email} (id ${result.id}).`);
  } catch (error) {
    if (error instanceof DomainError) {
      throw new Error(error.message);
    }
    throw error;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(`Falha ao criar admin: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

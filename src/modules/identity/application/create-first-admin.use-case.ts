import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { AdminAlreadyExistsError } from '../domain/errors/admin-already-exists.error';
import { EmailAlreadyRegisteredError } from '../domain/errors/email-already-registered.error';
import { PrismaUserRepository } from '../infrastructure/prisma-user.repository';

export interface CreateFirstAdminInput {
  email: string;
  name: string;
  password: string;
}

const inputSchema = z.object({
  email: z.string().email('Email invalido.'),
  name: z.string().min(1, 'Nome não pode ser vazio.'),
  password: z.string().min(8, 'Senha precisa de pelo menos 8 caracteres.'),
});

export interface CreateFirstAdminResult {
  id: string;
  email: string;
}

/**
 * Bootstrap do primeiro usuario ADMIN — ver scripts/create-admin-user.ts
 * (wrapper de CLI, so argv/prompt em cima disso). Recusa explicitamente se
 * JA existe qualquer ADMIN: sem essa trava, esse comando viraria uma porta
 * dos fundos pra criar admin extra sem passar pelo painel. Testado em
 * test/identity/create-first-admin.e2e-spec.ts (precisa do Postgres real).
 */
@Injectable()
export class CreateFirstAdminUseCase {
  constructor(private readonly users: PrismaUserRepository) {}

  async execute(rawInput: CreateFirstAdminInput): Promise<CreateFirstAdminResult> {
    const input = inputSchema.parse(rawInput);

    // Checa a trava de "so o primeiro admin" ANTES da validacao de email
    // duplicado de proposito — se ja existe um ADMIN, nem faz sentido dizer
    // "esse email ja existe", a resposta certa e sempre a mesma recusa.
    const existingAdminCount = await this.users.countByRole('ADMIN');
    if (existingAdminCount > 0) {
      throw new AdminAlreadyExistsError(existingAdminCount);
    }

    const existingUser = await this.users.findByEmail(input.email);
    if (existingUser) {
      throw new EmailAlreadyRegisteredError(input.email);
    }

    const passwordHash = await argon2.hash(input.password);
    const user = await this.users.create({
      email: input.email,
      name: input.name,
      passwordHash,
      role: 'ADMIN',
    });

    return { id: user.id, email: user.email };
  }
}

import { Injectable } from '@nestjs/common';
import { User, UserRole } from '@prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';

@Injectable()
export class PrismaUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async markLoggedIn(id: string, at: Date): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastLoginAt: at } });
  }

  countByRole(role: UserRole): Promise<number> {
    return this.prisma.user.count({ where: { role } });
  }

  create(input: { email: string; name: string; passwordHash: string; role: UserRole }): Promise<User> {
    return this.prisma.user.create({
      data: { email: input.email, name: input.name, passwordHash: input.passwordHash, role: input.role, active: true },
    });
  }
}

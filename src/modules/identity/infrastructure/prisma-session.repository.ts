import { Injectable } from '@nestjs/common';
import { Session, User } from '@prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';

export type SessionWithUser = Session & { user: User };

@Injectable()
export class PrismaSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    ip: string | null;
    userAgent: string | null;
  }): Promise<Session> {
    return this.prisma.session.create({ data: input });
  }

  findActiveByTokenHash(tokenHash: string, now: Date): Promise<SessionWithUser | null> {
    return this.prisma.session.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
      include: { user: true },
    });
  }

  async revokeByTokenHash(tokenHash: string, at: Date): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: at },
    });
  }
}

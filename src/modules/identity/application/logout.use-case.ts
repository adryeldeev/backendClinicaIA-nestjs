import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, Clock } from '../../../shared/kernel/clock';
import { PrismaSessionRepository } from '../infrastructure/prisma-session.repository';
import { hashSessionToken } from './login.use-case';

@Injectable()
export class LogoutUseCase {
  constructor(
    private readonly sessions: PrismaSessionRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(token: string): Promise<void> {
    await this.sessions.revokeByTokenHash(hashSessionToken(token), this.clock.now());
  }
}

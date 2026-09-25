import { Global, Module } from '@nestjs/common';
import { QueueModule } from '../../shared/queue/bullmq.module';
import { CLOCK, SystemClock } from '../../shared/kernel/clock';
import { AuditService } from './application/audit.service';
import { CreateFirstAdminUseCase } from './application/create-first-admin.use-case';
import { LoginUseCase } from './application/login.use-case';
import { LogoutUseCase } from './application/logout.use-case';
import { PrismaAuditLogRepository } from './infrastructure/prisma-audit-log.repository';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';
import { AuditInterceptor } from './interface/audit.interceptor';
import { AuthAdminController } from './interface/auth.admin-controller';
import { LoginRateLimitGuard } from './interface/guards/login-rate-limit.guard';
import { RolesGuard } from './interface/guards/roles.guard';
import { SessionGuard } from './interface/guards/session.guard';

/**
 * Global pelo mesmo motivo do DatabaseModule: SessionGuard/RolesGuard sao
 * usados por TODO controller admin em TODOS os outros modulos (Etapas
 * 2-5) — evita que cada modulo precise importar IdentityModule so pra
 * isso.
 *
 * Achado durante os testes (nao documentado claramente em lugar nenhum):
 * @nestjs/testing (TestingInjector, diferente do Injector de producao) so
 * resolve corretamente um guard usado FORA do modulo que o declara se toda
 * a cadeia TRANSITIVA de dependencias dele tambem estiver em `exports` —
 * exportar so o guard (SessionGuard/RolesGuard) nao bastou, precisou
 * exportar tambem PrismaSessionRepository/PrismaUserRepository/
 * PrismaAuditLogRepository/CLOCK que os guards/services usam por baixo.
 * @Global() sozinho NAO resolveu isso (testado) — o que resolveu foi essa
 * lista de exports mais completa.
 */
@Global()
@Module({
  imports: [QueueModule],
  controllers: [AuthAdminController],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    PrismaUserRepository,
    PrismaSessionRepository,
    PrismaAuditLogRepository,
    LoginUseCase,
    LogoutUseCase,
    CreateFirstAdminUseCase,
    AuditService,
    SessionGuard,
    RolesGuard,
    LoginRateLimitGuard,
    AuditInterceptor,
  ],
  exports: [
    SessionGuard,
    RolesGuard,
    AuditInterceptor,
    AuditService,
    CreateFirstAdminUseCase,
    PrismaSessionRepository,
    PrismaUserRepository,
    PrismaAuditLogRepository,
    CLOCK,
  ],
})
export class IdentityModule {}

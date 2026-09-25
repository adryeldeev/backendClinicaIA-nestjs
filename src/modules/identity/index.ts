export { IdentityModule } from './identity.module';
export { SessionGuard } from './interface/guards/session.guard';
export { RolesGuard } from './interface/guards/roles.guard';
export { Roles } from './interface/guards/roles.decorator';
export { CurrentUser } from './interface/current-user.decorator';
export { AuditInterceptor } from './interface/audit.interceptor';
export { AuditService } from './application/audit.service';
export type { AuthenticatedUser } from './domain/authenticated-user';
export { InvalidCredentialsError } from './domain/errors/invalid-credentials.error';
export { SessionExpiredError } from './domain/errors/session-expired.error';
export { LoginRateLimitedError } from './domain/errors/login-rate-limited.error';
export { AdminAlreadyExistsError } from './domain/errors/admin-already-exists.error';
export { EmailAlreadyRegisteredError } from './domain/errors/email-already-registered.error';
export {
  CreateFirstAdminUseCase,
  type CreateFirstAdminInput,
  type CreateFirstAdminResult,
} from './application/create-first-admin.use-case';

import type { UserRole } from '@prisma/client';

/** Anexado em `req.user` pelo SessionGuard — o que qualquer controller admin precisa pra decidir RBAC/filtro. */
export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  professionalId: string | null;
}

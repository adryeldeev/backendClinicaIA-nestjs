import type { AuthenticatedUser } from '../domain/authenticated-user';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};

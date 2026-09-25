import type { NextFunction, Request, Response } from 'express';

/**
 * SEC-09: so os 3 headers que a spec pede — nao o pacote de defaults do
 * helmet. Aplicado so em /api/admin/* (ver main.ts); a superficie publica
 * do webhook nao compartilha middleware com a admin, por SEC-06.
 */
export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}

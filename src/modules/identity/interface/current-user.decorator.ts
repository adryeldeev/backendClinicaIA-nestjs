import { createParamDecorator, ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import type { Request } from 'express';

/** So usar em rota protegida por SessionGuard — senao req.user nunca foi preenchido. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<Request>();
  if (!request.user) {
    throw new InternalServerErrorException(
      '@CurrentUser() usado numa rota sem SessionGuard — req.user nunca foi preenchido.',
    );
  }
  return request.user;
});

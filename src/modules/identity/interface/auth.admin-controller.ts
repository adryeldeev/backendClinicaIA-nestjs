import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Env } from '../../../shared/config/env.schema';
import { parseDto } from '../../../shared/http/parse-dto';
import { LoginUseCase } from '../application/login.use-case';
import { LogoutUseCase } from '../application/logout.use-case';
import { AuthenticatedUser } from '../domain/authenticated-user';
import { CurrentUser } from './current-user.decorator';
import { LoginRateLimitGuard } from './guards/login-rate-limit.guard';
import { SessionGuard } from './guards/session.guard';

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

@Controller('api/admin/auth')
export class AuthAdminController {
  constructor(
    private readonly login: LoginUseCase,
    private readonly logout: LogoutUseCase,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('login')
  @UseGuards(LoginRateLimitGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async loginHandler(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const body = parseDto(loginBodySchema, req.body);
    const result = await this.login.execute({
      email: body.email,
      password: body.password,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });

    res.cookie(this.config.get('SESSION_COOKIE_NAME', { infer: true }), result.token, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'lax',
      signed: true,
      expires: result.expiresAt,
    });
  }

  @Post('logout')
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutHandler(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const cookieName = this.config.get('SESSION_COOKIE_NAME', { infer: true });
    const token = req.signedCookies?.[cookieName];
    if (typeof token === 'string') {
      await this.logout.execute(token);
    }
    res.clearCookie(cookieName);
  }

  /**
   * Achado do usuario (2026-09-25): timezone pendente desde o primeiro dia
   * do painel, e a agenda depende dele pra renderizar horario — sem isso
   * o front nao tem como saber se o `startsAt` UTC de uma consulta e
   * "hoje 9h" ou "ontem 21h" na clinica. So uma clinica por deploy
   * (SPEC.md secao 3), entao `CLINIC_TIMEZONE` (env) ja e a fonte da
   * verdade — nao precisa de query no banco.
   */
  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser & { timezone: string } {
    return { ...user, timezone: this.config.get('CLINIC_TIMEZONE', { infer: true }) };
  }
}

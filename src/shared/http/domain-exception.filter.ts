import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '../kernel/domain-error';

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/**
 * Formato uniforme de erro da API admin (secao 5 da SPEC.md):
 * { error: { code, message } }. Um filtro cobre DomainError (code/httpStatus
 * proprios de cada erro concreto, sem mapa central pra manter); o outro
 * cobre HttpException nativa do Nest (guards, validacao de DTO) — mesmo
 * formato de saida, so a fonte do code/status muda.
 */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body: ErrorBody = {
      error: {
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      },
    };
    response.status(exception.httpStatus).json(body);
  }
}

/** "UnauthorizedException" -> "UNAUTHORIZED", "BadRequestException" -> "BAD_REQUEST". */
function toCode(exceptionName: string, status: number): string {
  const withoutSuffix = exceptionName.replace(/Exception$/, '');
  const snake = withoutSuffix.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  return snake || `HTTP_${status}`;
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    const payload = exception.getResponse();

    const message =
      typeof payload === 'string'
        ? payload
        : Array.isArray((payload as { message?: unknown }).message)
          ? ((payload as { message: string[] }).message.join('; '))
          : ((payload as { message?: string }).message ?? exception.message);

    const body: ErrorBody = { error: { code: toCode(exception.name, status), message } };
    response.status(status).json(body);
  }
}

/**
 * Rede de seguranca (achado do usuario, regressao de 2026-09-24): uma
 * excecao que nao e DomainError nem HttpException (erro cru do Prisma, bug
 * de programacao, etc.) escapava dos dois filtros acima e caia no handler
 * padrao do Nest — corpo `{statusCode, message}`, fora do envelope
 * uniforme que o front inteiro assume. Isso nao e especifico de uma rota:
 * QUALQUER excecao nao tratada em QUALQUER lugar da API tem que continuar
 * no formato `{error:{code,message}}`. `@Catch()` sem argumento casa com
 * tudo — registrado por ULTIMO em configureApp (Nest usa o primeiro filtro
 * cuja assinatura bate, entao os dois mais especificos acima continuam
 * tendo prioridade). Nunca vaza detalhe interno (stack, erro cru de banco)
 * pro cliente — só loga no servidor.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    this.logger.error(
      `Excecao nao tratada: ${exception instanceof Error ? (exception.stack ?? exception.message) : String(exception)}`,
    );
    const body: ErrorBody = {
      error: { code: 'INTERNAL_ERROR', message: 'Erro interno. Tente novamente em instantes.' },
    };
    response.status(500).json(body);
  }
}

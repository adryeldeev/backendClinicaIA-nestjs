import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { AuditService } from '../application/audit.service';

/**
 * SEC-10: todo EVENTO de acesso a dado de paciente pelo painel gera um
 * AuditLog — nao toda requisicao HTTP (achado do front, contrato da Fase 1:
 * polling de ~5s por conversa aberta gerava ~11 mil linhas/dia/recepcionista
 * sem sinal nenhum). `AuditService.record()` dedupe por (ator, entidade,
 * acao) dentro de `AUDIT_DEDUP_WINDOW_SECONDS` — esta interceptor sempre
 * CHAMA record(), a decisao de gravar ou nao mora la, nao aqui.
 * Aplicado via @UseInterceptors(AuditInterceptor) em cada controller admin
 * (Etapas 2-5) — nao globalmente: registrar como APP_INTERCEPTOR tocaria
 * tambem o webhook publico e o /health, sem sentido nenhum ali (SEC-06,
 * a superficie publica nao compartilha nada com a admin). Dentro do que
 * ele cobre, generico o bastante pra nao exigir que cada endpoint novo
 * lembre de auditar manualmente: `entityType`/`entityId` sao heuristicos
 * (segmento do path logo apos "admin" / primeiro :param da rota).
 * `before`/`after` ficam de fora por padrao (decisao 6 do plano da Fase 6):
 * so os poucos handlers que ja tem o dado em maos os populam via
 * res.locals.auditDiff.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      tap(() => {
        const routePath = (request.route as { path?: string } | undefined)?.path ?? request.path;
        const segments = routePath.split('/').filter(Boolean); // ['api','admin','patients',':id','cancel']
        // Pega o segmento logo apos 'admin' (nao um indice fixo) — robusto a
        // rotas com prefixo diferente, ex. controller de teste isolado.
        const adminIndex = segments.indexOf('admin');
        const entityType = (adminIndex >= 0 ? segments[adminIndex + 1] : segments[0]) ?? 'unknown';
        const paramSegment = segments.find((segment) => segment.startsWith(':'));
        const paramValue = paramSegment ? request.params[paramSegment.slice(1)] : undefined;
        const entityId = typeof paramValue === 'string' ? paramValue : 'n/a';
        const diff = (response.locals as { auditDiff?: { before?: unknown; after?: unknown } }).auditDiff;

        // Nunca deixa uma falha de auditoria derrubar a resposta ja enviada
        // ao cliente — best-effort, mas com log pra nao passar em silencio.
        this.audit
          .record({
            actorType: 'user',
            actorId: request.user?.id ?? null,
            action: `${request.method.toLowerCase()}:${routePath}`,
            entityType,
            entityId,
            before: diff?.before,
            after: diff?.after,
            ip: request.ip ?? null,
          })
          .catch((error: unknown) => {
            this.logger.error(`Falha ao gravar AuditLog: ${error instanceof Error ? error.message : String(error)}`);
          });
      }),
    );
  }
}

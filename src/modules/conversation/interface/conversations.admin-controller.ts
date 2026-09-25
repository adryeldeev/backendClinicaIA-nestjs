import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConversationStatus } from '@prisma/client';
import { z } from 'zod';
import { AuditInterceptor, AuthenticatedUser, CurrentUser, Roles, RolesGuard, SessionGuard } from '../../identity';
import { parseDto } from '../../../shared/http/parse-dto';
import { GetConversationDetailUseCase } from '../application/get-conversation-detail.use-case';
import { ListConversationsUseCase } from '../application/list-conversations.use-case';
import { ReleaseConversationUseCase } from '../application/release-conversation.use-case';
import { SearchConversationsUseCase } from '../application/search-conversations.use-case';
import { TakeoverConversationUseCase } from '../application/takeover-conversation.use-case';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

// `status` aceita multiplos valores separados por virgula (contrato da Fase
// 1, divergencia #2) — ausente = todas (MUDANCA DE CONTRATO, ver SPEC.md
// secao 5).
//
// `limit` e OPCIONAL, com padrao e teto do SERVIDOR (correcao do usuario
// apos regressao real, 2026-09-24): "paginacao obrigatoria" significava
// "a lista nunca pode ser ilimitada", nao "todo chamador precisa declarar
// o tamanho". Exigir o parametro quebrava qualquer chamada que o omitisse
// — e pior, `z.coerce.number()` sem `.default()`/`.optional()` roda a
// coercao ANTES de checar undefined: `Number(undefined)` e NaN, Zod
// reporta "Expected number, received nan" (mesma familia de armadilha do
// `z.coerce.boolean()` ja documentada no env.schema.ts). `.default(50)`
// resolve os dois problemas de uma vez: undefined nunca chega na coercao,
// e a lista nunca fica sem teto.
const listQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((raw) => raw?.split(',').map((value) => value.trim()))
    .pipe(z.array(z.nativeEnum(ConversationStatus)).optional()),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIST_LIMIT, `O limite máximo por página é ${MAX_LIST_LIMIT}.`)
    .default(DEFAULT_LIST_LIMIT),
  cursor: z.string().optional(),
});

// Alinhado ao mesmo contrato de listQuerySchema (achado do usuario,
// 2026-09-24): a busca nao seguia o formato da listagem — corrigido pra
// {items, nextCursor}, limit opcional com o mesmo padrao/teto do servidor.
const searchBodySchema = z.object({
  query: z.string().min(1),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIST_LIMIT, `O limite máximo por página é ${MAX_LIST_LIMIT}.`)
    .default(DEFAULT_LIST_LIMIT),
  cursor: z.string().optional(),
});

@Controller('api/admin/conversations')
@UseGuards(SessionGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('ADMIN', 'RECEPCAO')
export class ConversationsAdminController {
  constructor(
    private readonly listConversations: ListConversationsUseCase,
    private readonly searchConversations: SearchConversationsUseCase,
    private readonly getDetail: GetConversationDetailUseCase,
    private readonly takeover: TakeoverConversationUseCase,
    private readonly release: ReleaseConversationUseCase,
  ) {}

  @Get()
  list(@Query() query: unknown) {
    const dto = parseDto(listQuerySchema, query);
    return this.listConversations.execute({ statuses: dto.status, limit: dto.limit, cursor: dto.cursor });
  }

  // Antes de ':id' — Nest resolve por ordem de declaracao, e '/search' com
  // POST nunca colide com '/:id' (GET), mas mantido explicito por clareza.
  @Post('search')
  @HttpCode(HttpStatus.OK)
  search(@Body() body: unknown) {
    const dto = parseDto(searchBodySchema, body);
    return this.searchConversations.execute({ query: dto.query, limit: dto.limit, cursor: dto.cursor });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.getDetail.execute(id);
  }

  @Post(':id/takeover')
  @HttpCode(HttpStatus.OK)
  takeoverHandler(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.takeover.execute(id, user.id);
  }

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  releaseHandler(@Param('id') id: string) {
    return this.release.execute(id);
  }
}

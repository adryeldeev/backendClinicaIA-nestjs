import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { AuditInterceptor, Roles, RolesGuard, SessionGuard } from '../../identity';
import { parseDto } from '../../../shared/http/parse-dto';
import { CreateDocumentUseCase } from '../application/create-document.use-case';
import { GetDocumentUseCase } from '../application/get-document.use-case';
import { ListDocumentsUseCase } from '../application/list-documents.use-case';
import { ReindexDocumentUseCase } from '../application/reindex-document.use-case';
import { TestSearchUseCase } from '../application/test-search.use-case';

const createDocumentSchema = z.object({
  title: z.string().min(1),
  category: z.string().min(1),
  sourceRef: z.string().min(1).nullable().optional().transform((value) => value ?? null),
  content: z.string().min(1),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
});

const testSearchSchema = z.object({ pergunta: z.string().min(1) });

/**
 * Seção 5 da SPEC.md. POST/PUT/reindex são assíncronos de propósito
 * (achado do usuário): chunking+embedding é 1 chamada de rede por chunk,
 * documento grande estouraria timeout HTTP e um 503 no meio deixaria a
 * operação pela metade — a linha nasce PENDING e o job (ReindexKnowledgeDocumentJob)
 * processa fora da requisição. Ver comentário em PrismaKnowledgeRepository.activateVersion
 * pra troca atômica (a versão anterior nunca deixa de servir buscas).
 */
@Controller('api/admin/knowledge')
@UseGuards(SessionGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('ADMIN')
export class KnowledgeAdminController {
  constructor(
    private readonly listDocuments: ListDocumentsUseCase,
    private readonly getDocument: GetDocumentUseCase,
    private readonly createDocument: CreateDocumentUseCase,
    private readonly reindexDocument: ReindexDocumentUseCase,
    private readonly testSearch: TestSearchUseCase,
  ) {}

  @Get()
  list() {
    return this.listDocuments.execute();
  }

  @Post('test-search')
  @HttpCode(HttpStatus.OK)
  async runTestSearch(@Body() body: unknown) {
    const dto = parseDto(testSearchSchema, body);
    return this.testSearch.execute(dto.pergunta);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.getDocument.execute(id);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(@Body() body: unknown) {
    const dto = parseDto(createDocumentSchema, body);
    return this.createDocument.execute(dto);
  }

  @Put(':id')
  @HttpCode(HttpStatus.ACCEPTED)
  async update(@Param('id') id: string, @Body() body: unknown) {
    const dto = parseDto(updateDocumentSchema, body);
    return this.reindexDocument.execute(id, dto);
  }

  @Post(':id/reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  async reindex(@Param('id') id: string) {
    return this.reindexDocument.execute(id);
  }
}

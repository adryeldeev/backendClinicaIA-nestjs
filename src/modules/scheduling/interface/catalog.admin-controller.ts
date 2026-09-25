import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import {
  AuditInterceptor,
  Roles,
  RolesGuard,
  SessionGuard,
} from '../../identity';
import {
  ManageAvailabilityUseCase,
  ManageProceduresUseCase,
  ManageProfessionalsUseCase,
} from '../../catalog';
import { parseDto } from '../../../shared/http/parse-dto';
import { DeleteAvailabilityRuleUseCase } from '../application/delete-availability-rule.use-case';
import { UpdateAvailabilityRuleUseCase } from '../application/update-availability-rule.use-case';
import { UpdateProcedureUseCase } from '../application/update-procedure.use-case';
import { UpdateProfessionalUseCase } from '../application/update-professional.use-case';

const createProfessionalSchema = z.object({
  clinicId: z.string().uuid(),
  name: z.string().min(1),
  specialty: z.string().min(1),
  councilNumber: z.string().optional(),
});

const updateProfessionalSchema = z.object({
  name: z.string().min(1).optional(),
  specialty: z.string().min(1).optional(),
  councilNumber: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

const createProcedureSchema = z.object({
  clinicId: z.string().uuid(),
  name: z.string().min(1),
  durationMin: z.number().int().positive(),
  priceCents: z.number().int().nonnegative().optional(),
  requiresReturn: z.boolean().optional(),
});

const updateProcedureSchema = z.object({
  name: z.string().min(1).optional(),
  durationMin: z.number().int().positive().optional(),
  priceCents: z.number().int().nonnegative().nullable().optional(),
  requiresReturn: z.boolean().optional(),
  active: z.boolean().optional(),
});

const professionalIdQuerySchema = z.object({ professionalId: z.string().uuid() });

const createRuleSchema = z.object({
  professionalId: z.string().uuid(),
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  slotMinutes: z.number().int().positive().optional(),
});

const updateRuleSchema = z.object({
  weekday: z.number().int().min(0).max(6).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  slotMinutes: z.number().int().positive().optional(),
});

const exceptionsQuerySchema = z.object({
  professionalId: z.string().uuid(),
  from: z.coerce.date(),
  to: z.coerce.date(),
});

const createExceptionSchema = z.object({
  professionalId: z.string().uuid(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  reason: z.string().optional(),
  blocking: z.boolean().optional(),
});

/**
 * Achado do usuario (2026-09-25): GET de professionals/procedures nao pode
 * ser ADMIN-only — RECEPCAO precisa das duas listas pra filtrar e criar
 * consulta manual, Fase 2 do painel e impossivel sem isso (bug de RBAC,
 * nao conveniencia). `availability/rules`/`availability/exceptions`
 * CONTINUAM ADMIN-only (decisao explicita do usuario): definir quando um
 * profissional atende e bloquear data e configuracao da clinica; a
 * recepcao le disponibilidade por `GET /availability` (calcula slot
 * livre, controller de appointments), nao pelas regras cruas. `@Roles`
 * migrou de nivel de classe pra nivel de metodo — so onde ainda restringe.
 */
@Controller('api/admin/catalog')
@UseGuards(SessionGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
export class CatalogAdminController {
  constructor(
    private readonly manageProfessionals: ManageProfessionalsUseCase,
    private readonly manageProcedures: ManageProceduresUseCase,
    private readonly manageAvailability: ManageAvailabilityUseCase,
    private readonly updateProfessional: UpdateProfessionalUseCase,
    private readonly updateProcedure: UpdateProcedureUseCase,
    private readonly updateAvailabilityRule: UpdateAvailabilityRuleUseCase,
    private readonly deleteAvailabilityRule: DeleteAvailabilityRuleUseCase,
  ) {}

  @Get('professionals')
  listProfessionals() {
    return this.manageProfessionals.listAll();
  }

  @Post('professionals')
  @Roles('ADMIN')
  createProfessional(@Body() body: unknown) {
    return this.manageProfessionals.create(parseDto(createProfessionalSchema, body));
  }

  @Put('professionals/:id')
  @Roles('ADMIN')
  updateProfessionalHandler(@Param('id') id: string, @Body() body: unknown) {
    const dto = parseDto(updateProfessionalSchema, body);
    return this.updateProfessional.execute({ id, ...dto });
  }

  @Get('procedures')
  listProcedures() {
    return this.manageProcedures.listAll();
  }

  @Post('procedures')
  @Roles('ADMIN')
  createProcedure(@Body() body: unknown) {
    return this.manageProcedures.create(parseDto(createProcedureSchema, body));
  }

  @Put('procedures/:id')
  @Roles('ADMIN')
  updateProcedureHandler(@Param('id') id: string, @Body() body: unknown) {
    const dto = parseDto(updateProcedureSchema, body);
    return this.updateProcedure.execute({ id, ...dto });
  }

  @Get('availability/rules')
  @Roles('ADMIN')
  listRules(@Query() query: unknown) {
    const dto = parseDto(professionalIdQuerySchema, query);
    return this.manageAvailability.listRules(dto.professionalId);
  }

  @Post('availability/rules')
  @Roles('ADMIN')
  createRule(@Body() body: unknown) {
    return this.manageAvailability.createRule(parseDto(createRuleSchema, body));
  }

  @Put('availability/rules/:id')
  @Roles('ADMIN')
  updateRule(@Param('id') id: string, @Body() body: unknown) {
    const dto = parseDto(updateRuleSchema, body);
    return this.updateAvailabilityRule.execute({ id, ...dto });
  }

  @Delete('availability/rules/:id')
  @Roles('ADMIN')
  deleteRule(@Param('id') id: string) {
    return this.deleteAvailabilityRule.execute(id);
  }

  @Get('availability/exceptions')
  @Roles('ADMIN')
  listExceptions(@Query() query: unknown) {
    const dto = parseDto(exceptionsQuerySchema, query);
    return this.manageAvailability.listExceptions(dto.professionalId, dto.from, dto.to);
  }

  @Post('availability/exceptions')
  @Roles('ADMIN')
  createException(@Body() body: unknown) {
    return this.manageAvailability.createException(parseDto(createExceptionSchema, body));
  }

  @Delete('availability/exceptions/:id')
  @Roles('ADMIN')
  deleteException(@Param('id') id: string) {
    return this.manageAvailability.deleteException(id);
  }
}

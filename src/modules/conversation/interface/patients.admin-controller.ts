import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { AuditInterceptor, Roles, RolesGuard, SessionGuard } from '../../identity';
import { parseDto } from '../../../shared/http/parse-dto';
import { normalizePhoneToE164Br } from '../../../shared/kernel/normalize-phone-br';
import { CreatePatientUseCase } from '../application/create-patient.use-case';
import { GetPatientDetailUseCase } from '../application/get-patient-detail.use-case';
import { SearchPatientsUseCase } from '../application/search-patients.use-case';

const searchBodySchema = z.object({ query: z.string().min(1) });

// Achado do usuario (2026-09-25): telefone normalizado pro formato E.164
// NO SERVIDOR, nunca depende da tela mandar ja formatado — o `.transform`
// do Zod e o lugar certo (mesmo padrao ja usado pra `.coerce.date()`),
// falha com mensagem legivel via ctx.addIssue se o formato nao bate com
// nenhum jeito valido de telefone BR.
const createPatientBodySchema = z.object({
  name: z.string().min(1),
  phoneE164: z.string().transform((raw, ctx) => {
    const normalized = normalizePhoneToE164Br(raw);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Telefone em formato inválido.' });
      return z.NEVER;
    }
    return normalized;
  }),
  birthDate: z.coerce.date().optional(),
  insuranceId: z.string().uuid().optional(),
});

/** SEC-07: busca de paciente sempre no CORPO do POST, nunca query string. */
@Controller('api/admin/patients')
@UseGuards(SessionGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('ADMIN', 'RECEPCAO')
export class PatientsAdminController {
  constructor(
    private readonly searchPatients: SearchPatientsUseCase,
    private readonly createPatient: CreatePatientUseCase,
    private readonly getPatientDetail: GetPatientDetailUseCase,
  ) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  search(@Body() body: unknown) {
    const dto = parseDto(searchBodySchema, body);
    return this.searchPatients.execute(dto.query);
  }

  /** Cadastro manual pela recepcao (achado do usuario, 2026-09-25) — quem chega sem nunca ter mandado WhatsApp. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: unknown) {
    const dto = parseDto(createPatientBodySchema, body);
    return this.createPatient.execute(dto);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.getPatientDetail.execute(id);
  }
}

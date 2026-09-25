import { Body, Controller, Get, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { AuditInterceptor, Roles, RolesGuard, SessionGuard } from '../../identity';
import { parseDto } from '../../../shared/http/parse-dto';
import { ManageClinicSettingsUseCase } from '../application/manage-clinic-settings.use-case';

const setAiEnabledSchema = z.object({ enabled: z.boolean() });

/**
 * RN-25. Fica dentro do proprio modulo catalog (dono de Clinic) — ao
 * contrario de CatalogAdminController (Etapa 3, mora em scheduling por
 * precisar calcular impacto em Appointment), este endpoint nao le nada
 * de fora de catalog, entao nao ha conflito de grafo nenhum aqui.
 */
@Controller('api/admin/settings')
@UseGuards(SessionGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('ADMIN')
export class SettingsAdminController {
  constructor(private readonly manageClinicSettings: ManageClinicSettingsUseCase) {}

  @Get('ai-enabled')
  async getAiEnabled() {
    return { enabled: await this.manageClinicSettings.getAiEnabled() };
  }

  @Put('ai-enabled')
  async setAiEnabled(@Body() body: unknown) {
    const dto = parseDto(setAiEnabledSchema, body);
    return { enabled: await this.manageClinicSettings.setAiEnabled(dto.enabled) };
  }
}

import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity';
import { GetProcedureUseCase } from './application/get-procedure.use-case';
import { GetProfessionalUseCase } from './application/get-professional.use-case';
import { ListActiveProceduresUseCase } from './application/list-active-procedures.use-case';
import { ListActiveProfessionalsUseCase } from './application/list-active-professionals.use-case';
import { ListAvailableSlotsUseCase } from './application/list-available-slots.use-case';
import { ListInsurancePlansUseCase } from './application/list-insurance-plans.use-case';
import { ManageAvailabilityUseCase } from './application/manage-availability.use-case';
import { ManageClinicSettingsUseCase } from './application/manage-clinic-settings.use-case';
import { ManageProceduresUseCase } from './application/manage-procedures.use-case';
import { ManageProfessionalsUseCase } from './application/manage-professionals.use-case';
import { PrismaCatalogRepository } from './infrastructure/prisma-catalog.repository';
import { SettingsAdminController } from './interface/settings.admin-controller';

@Module({
  imports: [IdentityModule],
  controllers: [SettingsAdminController],
  providers: [
    PrismaCatalogRepository,
    ListAvailableSlotsUseCase,
    GetProfessionalUseCase,
    GetProcedureUseCase,
    ListActiveProceduresUseCase,
    ListActiveProfessionalsUseCase,
    ListInsurancePlansUseCase,
    ManageProfessionalsUseCase,
    ManageProceduresUseCase,
    ManageAvailabilityUseCase,
    ManageClinicSettingsUseCase,
  ],
  exports: [
    ListAvailableSlotsUseCase,
    GetProfessionalUseCase,
    GetProcedureUseCase,
    ListActiveProceduresUseCase,
    ListActiveProfessionalsUseCase,
    ListInsurancePlansUseCase,
    ManageProfessionalsUseCase,
    ManageProceduresUseCase,
    ManageAvailabilityUseCase,
    ManageClinicSettingsUseCase,
  ],
})
export class CatalogModule {}

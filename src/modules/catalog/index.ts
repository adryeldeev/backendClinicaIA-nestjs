export { CatalogModule } from './catalog.module';
export {
  ListAvailableSlotsUseCase,
  type ListAvailableSlotsInput,
} from './application/list-available-slots.use-case';
export { GetProfessionalUseCase, type ProfessionalDto } from './application/get-professional.use-case';
export { GetProcedureUseCase, type ProcedureDto } from './application/get-procedure.use-case';
export { ListActiveProceduresUseCase } from './application/list-active-procedures.use-case';
export {
  ListActiveProfessionalsUseCase,
  type ProfessionalListItemDto,
} from './application/list-active-professionals.use-case';
export {
  ListInsurancePlansUseCase,
  type InsurancePlanDto,
} from './application/list-insurance-plans.use-case';
export type { CandidateSlot } from './domain/services/slot-generator';
export { ProfessionalNotFoundError } from './domain/errors/professional-not-found.error';
export { ProcedureNotFoundError } from './domain/errors/procedure-not-found.error';
export { AvailabilityRuleNotFoundError } from './domain/errors/availability-rule-not-found.error';
export { AvailabilityExceptionNotFoundError } from './domain/errors/availability-exception-not-found.error';
export { ClinicNotFoundError } from './domain/errors/clinic-not-found.error';
export { ManageClinicSettingsUseCase } from './application/manage-clinic-settings.use-case';
export {
  ManageProfessionalsUseCase,
  type CreateProfessionalInput,
  type UpdateProfessionalInput,
} from './application/manage-professionals.use-case';
export {
  ManageProceduresUseCase,
  type CreateProcedureInput,
  type UpdateProcedureInput,
} from './application/manage-procedures.use-case';
export {
  ManageAvailabilityUseCase,
  type CreateAvailabilityRuleInput,
  type UpdateAvailabilityRuleInput,
  type CreateAvailabilityExceptionInput,
} from './application/manage-availability.use-case';

import { Injectable } from '@nestjs/common';
import { PrismaCatalogRepository } from '../infrastructure/prisma-catalog.repository';

export interface InsurancePlanDto {
  name: string;
  accepted: boolean;
  notes: string | null;
}

/**
 * Tool `consultar_convenios` (secao 9 da SPEC.md). AD-09: dado volatil
 * nunca vem do RAG — isso e sempre lido do banco.
 */
@Injectable()
export class ListInsurancePlansUseCase {
  constructor(private readonly catalog: PrismaCatalogRepository) {}

  async execute(nameFilter?: string): Promise<InsurancePlanDto[]> {
    const plans = await this.catalog.listInsurancePlans();
    const filtered = nameFilter
      ? plans.filter((plan) => plan.name.toLowerCase().includes(nameFilter.toLowerCase()))
      : plans;

    return filtered.map((plan) => ({
      name: plan.name,
      accepted: plan.accepted,
      notes: plan.notes,
    }));
  }
}

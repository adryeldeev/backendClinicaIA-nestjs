import { Injectable } from '@nestjs/common';
import { PrismaCatalogRepository } from '../infrastructure/prisma-catalog.repository';

export interface ProfessionalListItemDto {
  id: string;
  name: string;
  specialty: string;
}

/** Tool `listar_profissionais` (secao 9 da SPEC.md). */
@Injectable()
export class ListActiveProfessionalsUseCase {
  constructor(private readonly catalog: PrismaCatalogRepository) {}

  async execute(procedureId?: string): Promise<ProfessionalListItemDto[]> {
    const professionals = await this.catalog.listActiveProfessionals(procedureId);
    return professionals.map((professional) => ({
      id: professional.id,
      name: professional.name,
      specialty: professional.specialty,
    }));
  }
}

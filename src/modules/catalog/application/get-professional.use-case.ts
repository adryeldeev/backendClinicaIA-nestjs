import { Injectable } from '@nestjs/common';
import { ProfessionalNotFoundError } from '../domain/errors/professional-not-found.error';
import { PrismaCatalogRepository } from '../infrastructure/prisma-catalog.repository';

export interface ProfessionalDto {
  id: string;
  name: string;
  specialty: string;
  active: boolean;
  clinicTimezone: string;
}

@Injectable()
export class GetProfessionalUseCase {
  constructor(private readonly catalog: PrismaCatalogRepository) {}

  async execute(professionalId: string): Promise<ProfessionalDto> {
    const professional = await this.catalog.findProfessionalWithClinic(professionalId);
    if (!professional) {
      throw new ProfessionalNotFoundError(professionalId);
    }
    return {
      id: professional.id,
      name: professional.name,
      specialty: professional.specialty,
      active: professional.active,
      clinicTimezone: professional.clinic.timezone,
    };
  }
}

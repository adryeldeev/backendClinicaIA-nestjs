import { Injectable } from '@nestjs/common';
import { ProcedureNotFoundError } from '../domain/errors/procedure-not-found.error';
import { PrismaCatalogRepository } from '../infrastructure/prisma-catalog.repository';

export interface ProcedureDto {
  id: string;
  name: string;
  durationMin: number;
  active: boolean;
  priceCents: number | null;
}

@Injectable()
export class GetProcedureUseCase {
  constructor(private readonly catalog: PrismaCatalogRepository) {}

  async execute(procedureId: string): Promise<ProcedureDto> {
    const procedure = await this.catalog.findProcedureById(procedureId);
    if (!procedure) {
      throw new ProcedureNotFoundError(procedureId);
    }
    return {
      id: procedure.id,
      name: procedure.name,
      durationMin: procedure.durationMin,
      active: procedure.active,
      priceCents: procedure.priceCents,
    };
  }
}

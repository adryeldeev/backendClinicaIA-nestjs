import { Injectable } from '@nestjs/common';
import { PrismaCatalogRepository } from '../infrastructure/prisma-catalog.repository';
import type { ProcedureDto } from './get-procedure.use-case';

/** Tool `listar_procedimentos` (secao 9 da SPEC.md). */
@Injectable()
export class ListActiveProceduresUseCase {
  constructor(private readonly catalog: PrismaCatalogRepository) {}

  async execute(): Promise<ProcedureDto[]> {
    const procedures = await this.catalog.listActiveProcedures();
    return procedures.map((procedure) => ({
      id: procedure.id,
      name: procedure.name,
      durationMin: procedure.durationMin,
      active: procedure.active,
      priceCents: procedure.priceCents,
    }));
  }
}

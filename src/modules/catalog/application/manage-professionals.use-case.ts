import { Injectable } from '@nestjs/common';
import { Professional } from '@prisma/client';
import { ProfessionalNotFoundError } from '../domain/errors/professional-not-found.error';
import { PrismaCatalogRepository } from '../infrastructure/prisma-catalog.repository';

export interface CreateProfessionalInput {
  clinicId: string;
  name: string;
  specialty: string;
  councilNumber?: string;
}

export interface UpdateProfessionalInput {
  id: string;
  name?: string;
  specialty?: string;
  councilNumber?: string | null;
  active?: boolean;
}

/**
 * Escrita PURA de Professional — nao sabe nada sobre Appointment de
 * proposito (o grafo de modulos nao permite catalog depender de
 * scheduling). Desativar um profissional com consulta futura confirmada
 * (Caso 1 do plano da Etapa 3) e decisao de scheduling
 * (DeactivateProfessionalUseCase, que chama este metodo pra escrever e
 * depois consulta a propria PrismaAppointmentRepository pro aviso) — este
 * use case so grava o que foi pedido.
 */
@Injectable()
export class ManageProfessionalsUseCase {
  constructor(private readonly catalog: PrismaCatalogRepository) {}

  create(input: CreateProfessionalInput): Promise<Professional> {
    return this.catalog.createProfessional(input);
  }

  /** Ativos e inativos — o painel precisa ver os dois pra poder reativar. */
  listAll(): Promise<Professional[]> {
    return this.catalog.listAllProfessionals();
  }

  async update(input: UpdateProfessionalInput): Promise<Professional> {
    const existing = await this.catalog.findProfessionalWithClinic(input.id);
    if (!existing) {
      throw new ProfessionalNotFoundError(input.id);
    }
    return this.catalog.updateProfessional(input.id, {
      name: input.name,
      specialty: input.specialty,
      councilNumber: input.councilNumber,
      active: input.active,
    });
  }
}

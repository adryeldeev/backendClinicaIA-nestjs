import { Injectable } from '@nestjs/common';
import { Procedure } from '@prisma/client';
import { ProcedureNotFoundError } from '../domain/errors/procedure-not-found.error';
import { PrismaCatalogRepository } from '../infrastructure/prisma-catalog.repository';

export interface CreateProcedureInput {
  clinicId: string;
  name: string;
  durationMin: number;
  priceCents?: number;
  requiresReturn?: boolean;
}

export interface UpdateProcedureInput {
  id: string;
  name?: string;
  durationMin?: number;
  priceCents?: number | null;
  requiresReturn?: boolean;
  active?: boolean;
}

/**
 * Escrita PURA de Procedure. `durationMin` (Caso 2 do plano da Etapa 3):
 * mudar aqui NUNCA toca em Appointment.endsAt de consultas ja marcadas —
 * essas colunas sao proprias, gravadas no momento da reserva
 * (HoldSlotUseCase calcula `endsAt = startsAt + procedure.durationMin`
 * SÓ NAQUELE INSTANTE). Nenhuma leitura futura deriva a duracao do
 * procedimento — mudar isso quebraria consultas antigas retroativamente e
 * faria a constraint de exclusao acusar sobreposicao que nao existia.
 * Ver test/scheduling/catalog-admin-controller.e2e-spec.ts (regressao).
 */
@Injectable()
export class ManageProceduresUseCase {
  constructor(private readonly catalog: PrismaCatalogRepository) {}

  create(input: CreateProcedureInput): Promise<Procedure> {
    return this.catalog.createProcedure(input);
  }

  /** Ativos e inativos — o painel precisa ver os dois pra poder reativar. */
  listAll(): Promise<Procedure[]> {
    return this.catalog.listAllProcedures();
  }

  async update(input: UpdateProcedureInput): Promise<Procedure> {
    const existing = await this.catalog.findProcedureById(input.id);
    if (!existing) {
      throw new ProcedureNotFoundError(input.id);
    }
    return this.catalog.updateProcedure(input.id, {
      name: input.name,
      durationMin: input.durationMin,
      priceCents: input.priceCents,
      requiresReturn: input.requiresReturn,
      active: input.active,
    });
  }
}

import { Injectable } from '@nestjs/common';
import { AvailabilityException, AvailabilityRule } from '@prisma/client';
import { AvailabilityExceptionNotFoundError } from '../domain/errors/availability-exception-not-found.error';
import { AvailabilityRuleNotFoundError } from '../domain/errors/availability-rule-not-found.error';
import { PrismaCatalogRepository } from '../infrastructure/prisma-catalog.repository';

export interface CreateAvailabilityRuleInput {
  professionalId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  slotMinutes?: number;
}

export interface UpdateAvailabilityRuleInput {
  id: string;
  weekday?: number;
  startTime?: string;
  endTime?: string;
  slotMinutes?: number;
}

export interface CreateAvailabilityExceptionInput {
  professionalId: string;
  startsAt: Date;
  endsAt: Date;
  reason?: string;
  blocking?: boolean;
}

/**
 * Escrita PURA de AvailabilityRule/AvailabilityException. Reduzir a janela
 * de uma regra com consulta confirmada fora dela (Caso 3 do plano da
 * Etapa 3) e decisao de scheduling (UpdateAvailabilityRuleUseCase/
 * DeleteAvailabilityRuleUseCase, que chamam este metodo pra escrever e
 * depois calculam o impacto via find-appointments-outside-window) — este
 * use case so grava o que foi pedido, sem saber de Appointment.
 */
@Injectable()
export class ManageAvailabilityUseCase {
  constructor(private readonly catalog: PrismaCatalogRepository) {}

  createRule(input: CreateAvailabilityRuleInput): Promise<AvailabilityRule> {
    return this.catalog.createAvailabilityRule(input);
  }

  listRules(professionalId: string): Promise<AvailabilityRule[]> {
    return this.catalog.listAvailabilityRules(professionalId);
  }

  /**
   * Usado por UpdateAvailabilityRuleUseCase/DeleteAvailabilityRuleUseCase
   * (scheduling) pra saber o professionalId/weekday ANTES de calcular o
   * impacto em Appointment — catalog nao pode ser o dono desse calculo
   * (ver comentario no topo do arquivo), mas precisa expor a leitura.
   */
  async getRule(id: string): Promise<AvailabilityRule> {
    const rule = await this.catalog.findAvailabilityRuleById(id);
    if (!rule) {
      throw new AvailabilityRuleNotFoundError(id);
    }
    return rule;
  }

  updateRule(input: UpdateAvailabilityRuleInput): Promise<AvailabilityRule> {
    return this.catalog.updateAvailabilityRule(input.id, {
      weekday: input.weekday,
      startTime: input.startTime,
      endTime: input.endTime,
      slotMinutes: input.slotMinutes,
    });
  }

  deleteRule(id: string): Promise<void> {
    return this.catalog.deleteAvailabilityRule(id);
  }

  listExceptions(professionalId: string, fromUtc: Date, toUtc: Date): Promise<AvailabilityException[]> {
    return this.catalog.listAvailabilityExceptions(professionalId, fromUtc, toUtc);
  }

  createException(input: CreateAvailabilityExceptionInput): Promise<AvailabilityException> {
    return this.catalog.createAvailabilityException(input);
  }

  /**
   * Achado do teste de contrato (regressao real, 2026-09-24): sem checar
   * existencia antes, `prisma.availabilityException.delete()` pra um id
   * inexistente lancava PrismaClientKnownRequestError (P2025) cru — nao e
   * DomainError nem HttpException, escapava do envelope uniforme (so o
   * AllExceptionsFilter, rede de seguranca, pegava, com 500 generico em
   * vez do 404 que faz sentido pra "id nao existe"). Diferente de
   * deleteRule (controller chama DeleteAvailabilityRuleUseCase, em
   * scheduling, que ja checa via getRule antes) — excecao nao tem
   * wrapper de impacto, entao o check mora aqui.
   */
  async deleteException(id: string): Promise<void> {
    const exception = await this.catalog.findAvailabilityExceptionById(id);
    if (!exception) {
      throw new AvailabilityExceptionNotFoundError(id);
    }
    await this.catalog.deleteAvailabilityException(id);
  }
}

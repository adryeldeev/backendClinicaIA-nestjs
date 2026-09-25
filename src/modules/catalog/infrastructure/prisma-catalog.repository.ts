import { Injectable } from '@nestjs/common';
import {
  AvailabilityException,
  AvailabilityRule,
  Clinic,
  InsurancePlan,
  Procedure,
  Professional,
} from '@prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';

export type ProfessionalWithClinic = Professional & { clinic: Clinic };

@Injectable()
export class PrismaCatalogRepository {
  constructor(private readonly prisma: PrismaService) {}

  findProfessionalWithClinic(professionalId: string): Promise<ProfessionalWithClinic | null> {
    return this.prisma.professional.findUnique({
      where: { id: professionalId },
      include: { clinic: true },
    });
  }

  findProcedureById(procedureId: string): Promise<Procedure | null> {
    return this.prisma.procedure.findUnique({ where: { id: procedureId } });
  }

  listAvailabilityRules(professionalId: string): Promise<AvailabilityRule[]> {
    return this.prisma.availabilityRule.findMany({ where: { professionalId } });
  }

  listAvailabilityExceptions(
    professionalId: string,
    fromUtc: Date,
    toUtc: Date,
  ): Promise<AvailabilityException[]> {
    return this.prisma.availabilityException.findMany({
      where: {
        professionalId,
        startsAt: { lt: toUtc },
        endsAt: { gt: fromUtc },
      },
    });
  }

  listActiveProcedures(): Promise<Procedure[]> {
    return this.prisma.procedure.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  }

  /** Painel admin precisa ver tambem os inativos, pra poder reativar. */
  listAllProcedures(): Promise<Procedure[]> {
    return this.prisma.procedure.findMany({ orderBy: { name: 'asc' } });
  }

  listAllProfessionals(): Promise<Professional[]> {
    return this.prisma.professional.findMany({ orderBy: { name: 'asc' } });
  }

  listActiveProfessionals(procedureId?: string): Promise<Professional[]> {
    return this.prisma.professional.findMany({
      where: {
        active: true,
        ...(procedureId ? { procedures: { some: { procedureId } } } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  listInsurancePlans(): Promise<InsurancePlan[]> {
    return this.prisma.insurancePlan.findMany({ orderBy: { name: 'asc' } });
  }

  createProfessional(data: {
    clinicId: string;
    name: string;
    specialty: string;
    councilNumber?: string;
  }): Promise<Professional> {
    return this.prisma.professional.create({ data });
  }

  updateProfessional(
    id: string,
    data: Partial<{ name: string; specialty: string; councilNumber: string | null; active: boolean }>,
  ): Promise<Professional> {
    return this.prisma.professional.update({ where: { id }, data });
  }

  createProcedure(data: {
    clinicId: string;
    name: string;
    durationMin: number;
    priceCents?: number;
    requiresReturn?: boolean;
  }): Promise<Procedure> {
    return this.prisma.procedure.create({ data });
  }

  updateProcedure(
    id: string,
    data: Partial<{ name: string; durationMin: number; priceCents: number | null; requiresReturn: boolean; active: boolean }>,
  ): Promise<Procedure> {
    return this.prisma.procedure.update({ where: { id }, data });
  }

  findAvailabilityRuleById(id: string): Promise<AvailabilityRule | null> {
    return this.prisma.availabilityRule.findUnique({ where: { id } });
  }

  createAvailabilityRule(data: {
    professionalId: string;
    weekday: number;
    startTime: string;
    endTime: string;
    slotMinutes?: number;
  }): Promise<AvailabilityRule> {
    return this.prisma.availabilityRule.create({ data });
  }

  updateAvailabilityRule(
    id: string,
    data: Partial<{ weekday: number; startTime: string; endTime: string; slotMinutes: number }>,
  ): Promise<AvailabilityRule> {
    return this.prisma.availabilityRule.update({ where: { id }, data });
  }

  async deleteAvailabilityRule(id: string): Promise<void> {
    await this.prisma.availabilityRule.delete({ where: { id } });
  }

  createAvailabilityException(data: {
    professionalId: string;
    startsAt: Date;
    endsAt: Date;
    reason?: string;
    blocking?: boolean;
  }): Promise<AvailabilityException> {
    return this.prisma.availabilityException.create({ data });
  }

  findAvailabilityExceptionById(id: string): Promise<AvailabilityException | null> {
    return this.prisma.availabilityException.findUnique({ where: { id } });
  }

  async deleteAvailabilityException(id: string): Promise<void> {
    await this.prisma.availabilityException.delete({ where: { id } });
  }

  /**
   * RN-25: assume UMA clinica (sempre a mais antiga, `createdAt` asc) —
   * o schema modela `Clinic` como se pudesse haver varias, mas nada no
   * resto do projeto (Patient/Conversation/User sem clinicId) trata
   * multi-clinica de verdade hoje. Documentado como limitacao assumida,
   * nao escondida: se um dia precisar de multi-clinica de verdade, isso
   * precisa de Patient.clinicId (ou equivalente) pra saber qual clinica
   * uma conversa pertence — nao existe forma de derivar isso hoje.
   */
  findPrimaryClinic(): Promise<Clinic | null> {
    return this.prisma.clinic.findFirst({ orderBy: { createdAt: 'asc' } });
  }

  setAiEnabled(clinicId: string, enabled: boolean): Promise<Clinic> {
    return this.prisma.clinic.update({ where: { id: clinicId }, data: { aiEnabled: enabled } });
  }
}

import { Injectable } from '@nestjs/common';
import { Patient } from '@prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';

@Injectable()
export class PrismaPatientRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByPhone(phoneE164: string): Promise<Patient | null> {
    return this.prisma.patient.findUnique({ where: { phoneE164 } });
  }

  findById(id: string): Promise<Patient | null> {
    return this.prisma.patient.findUnique({ where: { id } });
  }

  create(phoneE164: string): Promise<Patient> {
    return this.prisma.patient.create({ data: { phoneE164 } });
  }

  /**
   * POST /api/admin/patients — cadastro manual pela recepcao (achado do
   * usuario, 2026-09-25). Distinto de `create` (usado pelo fluxo do
   * agente, so telefone): aqui o nome ja vem preenchido, e
   * birthDate/insuranceId sao opcionais desde a criacao.
   */
  createManual(input: { phoneE164: string; name: string; birthDate?: Date; insuranceId?: string }): Promise<Patient> {
    return this.prisma.patient.create({
      data: { phoneE164: input.phoneE164, name: input.name, birthDate: input.birthDate, insuranceId: input.insuranceId },
    });
  }

  /**
   * POST /api/admin/patients/search — SEC-07 (nunca em query string, so no
   * corpo). Busca por nome (contains, case-insensitive) OU telefone
   * (contains) — o painel manda o que o usuario digitou, sem saber se e
   * nome ou telefone.
   */
  search(query: string): Promise<Patient[]> {
    return this.prisma.patient.findMany({
      where: {
        OR: [{ name: { contains: query, mode: 'insensitive' } }, { phoneE164: { contains: query } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}

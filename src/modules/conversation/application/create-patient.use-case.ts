import { Injectable } from '@nestjs/common';
import { Patient } from '@prisma/client';
import { DuplicateEntryError } from '../../../shared/kernel/errors/duplicate-entry.error';
import { PatientPhoneAlreadyRegisteredError } from '../domain/errors/patient-phone-already-registered.error';
import { PrismaPatientRepository } from '../infrastructure/prisma-patient.repository';

export interface CreatePatientInput {
  phoneE164: string; // ja normalizado — a normalizacao mora no schema Zod do controller (SEC-02 nao se aplica aqui, e formato, nao segredo)
  name: string;
  birthDate?: Date;
  insuranceId?: string;
}

/**
 * POST /api/admin/patients — cadastro manual pela recepcao (achado do
 * usuario, 2026-09-25): o balcao precisa cadastrar quem chega sem nunca
 * ter mandado WhatsApp. Telefone duplicado (achado do usuario: "o caso
 * mais comum do balcao — a pessoa ja conversou pelo WhatsApp e ja tem
 * cadastro") nao vira 409 generico: busca o paciente existente pelo
 * mesmo telefone e devolve o id dele em `details`, pra tela oferecer
 * "abrir cadastro" em vez de so "falhou".
 */
@Injectable()
export class CreatePatientUseCase {
  constructor(private readonly patients: PrismaPatientRepository) {}

  async execute(input: CreatePatientInput): Promise<Patient> {
    try {
      return await this.patients.createManual(input);
    } catch (error) {
      if (error instanceof DuplicateEntryError && error.fields.includes('phoneE164')) {
        const existing = await this.patients.findByPhone(input.phoneE164);
        if (existing) {
          throw new PatientPhoneAlreadyRegisteredError(existing.id);
        }
      }
      throw error;
    }
  }
}

import { Injectable } from '@nestjs/common';
import { Patient } from '@prisma/client';
import { PatientNotFoundError } from '../domain/errors/patient-not-found.error';
import { PrismaPatientRepository } from '../infrastructure/prisma-patient.repository';

/** GET /api/admin/patients/:id (achado do usuario, 2026-09-25). */
@Injectable()
export class GetPatientDetailUseCase {
  constructor(private readonly patients: PrismaPatientRepository) {}

  async execute(id: string): Promise<Patient> {
    const patient = await this.patients.findById(id);
    if (!patient) {
      throw new PatientNotFoundError(id);
    }
    return patient;
  }
}

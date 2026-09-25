import { Injectable } from '@nestjs/common';
import { Patient } from '@prisma/client';
import { PrismaPatientRepository } from '../infrastructure/prisma-patient.repository';

/** POST /api/admin/patients/search — corpo, nunca query string (SEC-07). */
@Injectable()
export class SearchPatientsUseCase {
  constructor(private readonly patients: PrismaPatientRepository) {}

  execute(query: string): Promise<Patient[]> {
    return this.patients.search(query);
  }
}

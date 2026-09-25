import { Injectable } from '@nestjs/common';
import { ClinicNotFoundError } from '../domain/errors/clinic-not-found.error';
import { PrismaCatalogRepository } from '../infrastructure/prisma-catalog.repository';

/**
 * RN-25 (interruptor global de IA): GET/PUT /api/admin/settings/ai-enabled.
 * Ver o comentario em findPrimaryClinic() no repositorio sobre a
 * limitacao assumida de "uma clinica so".
 */
@Injectable()
export class ManageClinicSettingsUseCase {
  constructor(private readonly catalog: PrismaCatalogRepository) {}

  async getAiEnabled(): Promise<boolean> {
    const clinic = await this.catalog.findPrimaryClinic();
    if (!clinic) {
      throw new ClinicNotFoundError();
    }
    return clinic.aiEnabled;
  }

  async setAiEnabled(enabled: boolean): Promise<boolean> {
    const clinic = await this.catalog.findPrimaryClinic();
    if (!clinic) {
      throw new ClinicNotFoundError();
    }
    const updated = await this.catalog.setAiEnabled(clinic.id, enabled);
    return updated.aiEnabled;
  }
}

import { Injectable } from '@nestjs/common';
import { Patient } from '@prisma/client';
import { DuplicateEntryError } from '../../../shared/kernel/errors/duplicate-entry.error';
import { PrismaConversationRepository } from '../infrastructure/prisma-conversation.repository';
import { PrismaPatientRepository } from '../infrastructure/prisma-patient.repository';

export interface GetOrCreateConversationResult {
  conversationId: string;
  patientId: string;
}

/**
 * Achado do usuario (regressao de 2026-09-24, achada pela propria suite):
 * `PrismaService` agora traduz P2002 pra `DuplicateEntryError` NUM LUGAR
 * SO — o erro cru do Prisma nunca chega aqui (a extensao intercepta toda
 * query). Check pelo codigo bruto removido — ramo morto.
 *
 * Segundo achado do usuario, mesmo dia: tipo sozinho nao basta. `Patient`
 * so tem UMA constraint unica (`phoneE164`) — mas sem checar o campo, um
 * `DuplicateEntryError` de OUTRA coluna (se o schema ganhar mais uma
 * unique no futuro) cairia aqui e seria lido como "corrida de criacao do
 * mesmo paciente", escondendo um bug real atras de uma releitura que
 * parece correta.
 */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof DuplicateEntryError && error.fields.includes('phoneE164');
}

@Injectable()
export class GetOrCreateConversationUseCase {
  constructor(
    private readonly patients: PrismaPatientRepository,
    private readonly conversations: PrismaConversationRepository,
  ) {}

  async execute(phoneE164: string): Promise<GetOrCreateConversationResult> {
    const patient = await this.getOrCreatePatient(phoneE164);

    const conversation =
      (await this.conversations.findOpenByPatientId(patient.id)) ??
      (await this.conversations.create(patient.id));

    return { conversationId: conversation.id, patientId: patient.id };
  }

  private async getOrCreatePatient(phoneE164: string): Promise<Patient> {
    const existing = await this.patients.findByPhone(phoneE164);
    if (existing) {
      return existing;
    }

    try {
      return await this.patients.create(phoneE164);
    } catch (error) {
      // Duas mensagens quase simultaneas do mesmo paciente novo podem
      // colidir na constraint unique de phoneE164 — a segunda so precisa
      // reler o registro criado pela primeira.
      if (isUniqueViolation(error)) {
        const raceWinner = await this.patients.findByPhone(phoneE164);
        if (raceWinner) {
          return raceWinner;
        }
      }
      throw error;
    }
  }
}

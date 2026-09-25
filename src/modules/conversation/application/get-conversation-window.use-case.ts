import { Injectable } from '@nestjs/common';
import { PrismaConversationRepository } from '../infrastructure/prisma-conversation.repository';
import { PrismaPatientRepository } from '../infrastructure/prisma-patient.repository';

export interface ConversationWindowResult {
  windowExpiresAt: Date | null;
}

/**
 * RN-18: fora da janela de 24h do WhatsApp so e possivel enviar template
 * aprovado. Usado pelo outbox (modulo messaging) pra decidir se pode
 * mandar texto livre ou precisa recusar antes de tentar — nao expoe
 * repositorio nem entidade, so o dado minimo que quem chama precisa.
 */
@Injectable()
export class GetConversationWindowUseCase {
  constructor(
    private readonly patients: PrismaPatientRepository,
    private readonly conversations: PrismaConversationRepository,
  ) {}

  async execute(phoneE164: string): Promise<ConversationWindowResult | null> {
    const patient = await this.patients.findByPhone(phoneE164);
    if (!patient) {
      return null;
    }
    const conversation = await this.conversations.findOpenByPatientId(patient.id);
    if (!conversation) {
      return null;
    }
    return { windowExpiresAt: conversation.windowExpiresAt };
  }
}

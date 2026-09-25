import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { PrismaMessageRepository } from '../infrastructure/prisma-message.repository';

const MINUTE_MS = 60 * 1000;

/**
 * RN-16 (job varredor, registrado na SPEC.md secao 12 apos o teste manual
 * da Fase 3): mensagem de paciente presa por falha transitoria de LLM
 * (llm_error nao marca consumido nem escala, de proposito) so e
 * reprocessada se o proprio paciente mandar outra mensagem. Sem alguem
 * checando isso, um paciente que nao insiste fica sem resposta pra
 * sempre. Usado por ReprocessStuckTurnsJob (modulo messaging).
 */
@Injectable()
export class FindStuckConversationsUseCase {
  constructor(
    private readonly messages: PrismaMessageRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(stuckAfterMinutes: number): Promise<string[]> {
    const cutoff = new Date(this.clock.now().getTime() - stuckAfterMinutes * MINUTE_MS);
    return this.messages.findConversationIdsWithStuckMessages(cutoff);
  }
}

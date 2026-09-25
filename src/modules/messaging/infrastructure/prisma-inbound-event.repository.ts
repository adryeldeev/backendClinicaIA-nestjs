import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DuplicateEntryError } from '../../../shared/kernel/errors/duplicate-entry.error';
import { PrismaService } from '../../../shared/database/prisma.service';

/**
 * Achado do usuario (regressao de 2026-09-24, achada pela propria suite):
 * `PrismaService` agora traduz P2002 pra `DuplicateEntryError` NUM LUGAR
 * SO, antes de qualquer erro cru do Prisma sair do repositorio — o erro
 * que chega aqui nunca e `Prisma.PrismaClientKnownRequestError` (a
 * extensao intercepta toda query via `$allModels.$allOperations`, sem
 * excecao pra este metodo). O check pelo codigo bruto foi removido — era
 * ramo morto, sugeria uma protecao que nada exercitava.
 *
 * Segundo achado do usuario, mesmo dia: tipo sozinho nao basta. Este
 * `create()` so escreve numa tabela com UMA constraint unica
 * (`externalId`, a chave de idempotencia do AD-06) — se isso mudar um
 * dia, um `DuplicateEntryError` de OUTRA coluna cairia aqui e seria lido
 * como "wamid ja processado", descartando a mensagem calada. Checa o
 * campo, nao so o tipo.
 */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof DuplicateEntryError && error.fields.includes('externalId');
}

@Injectable()
export class PrismaInboundEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tenta registrar o evento. Retorna false quando o wamid ja foi
   * processado antes (AD-06 idempotencia) — nesse caso o chamador deve
   * descartar a mensagem sem reprocessar.
   */
  async tryRegister(externalId: string, payload: Prisma.InputJsonValue): Promise<boolean> {
    try {
      await this.prisma.inboundEvent.create({ data: { externalId, payload } });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Marca o evento como processado assim que seu conteudo foi capturado
   * de forma duravel (Message persistida). Nao tem relacao com
   * idempotencia — isso e garantido pela constraint unica de externalId
   * em tryRegister, independente deste campo. processedAt existe so para
   * observabilidade (painel admin, job de expurgo por retencao).
   */
  async markProcessed(externalId: string): Promise<void> {
    await this.prisma.inboundEvent.update({
      where: { externalId },
      data: { processedAt: new Date() },
    });
  }
}

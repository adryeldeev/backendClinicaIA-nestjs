import { Injectable } from '@nestjs/common';
import { OutboxMessage, OutboxStatus } from '@prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';

@Injectable()
export class PrismaOutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(toPhoneE164: string, body: string): Promise<OutboxMessage> {
    return this.prisma.outboxMessage.create({ data: { toPhoneE164, body } });
  }

  /** Lembrete de 24h (Fase 5) e qualquer outro envio via template — body fica vazio, o texto real vem do template aprovado na Meta. */
  createTemplate(toPhoneE164: string, templateName: string, templateArgs: string[]): Promise<OutboxMessage> {
    return this.prisma.outboxMessage.create({
      data: { toPhoneE164, body: '', templateName, templateArgs },
    });
  }

  findById(id: string): Promise<OutboxMessage | null> {
    return this.prisma.outboxMessage.findUnique({ where: { id } });
  }

  markSent(id: string): Promise<OutboxMessage> {
    return this.prisma.outboxMessage.update({
      where: { id },
      data: { status: OutboxStatus.SENT, sentAt: new Date(), attempts: { increment: 1 } },
    });
  }

  markAttemptFailed(id: string, lastError: string): Promise<OutboxMessage> {
    return this.prisma.outboxMessage.update({
      where: { id },
      data: { attempts: { increment: 1 }, lastError },
    });
  }

  markFailed(id: string, lastError: string): Promise<OutboxMessage> {
    return this.prisma.outboxMessage.update({
      where: { id },
      data: { status: OutboxStatus.FAILED, lastError },
    });
  }

  /**
   * Achado do usuario (2026-09-24): com OUTBOX_DISPATCH_ENABLED=false, o
   * job marcava SENT sem ter chamado a WhatsApp Cloud API — o painel
   * mostrava "entregue" pra mensagem que nunca saiu. SENT volta a
   * significar uma coisa so: a Cloud API aceitou. Sem `sentAt`/incremento
   * de `attempts` — nunca houve tentativa real de entrega.
   */
  markSkipped(id: string): Promise<OutboxMessage> {
    return this.prisma.outboxMessage.update({
      where: { id },
      data: { status: OutboxStatus.SKIPPED },
    });
  }
}

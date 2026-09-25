import type { MessagingPort, SendTextResult } from '../../src/modules/messaging';

/**
 * MessagingPort que sempre falha — usado para provar que o outbox
 * esgota as tentativas e marca o OutboxMessage como FAILED (regressao
 * do bug de off-by-one em job.attemptsMade encontrado manualmente na
 * Fase 1).
 */
export class AlwaysFailingMessagingPort implements MessagingPort {
  public callCount = 0;

  async sendText(): Promise<SendTextResult> {
    this.callCount += 1;
    throw new Error('falha simulada de envio (teste de exaustao de retry)');
  }

  async sendTemplate(): Promise<SendTextResult> {
    this.callCount += 1;
    throw new Error('falha simulada de envio de template (teste de exaustao de retry)');
  }
}

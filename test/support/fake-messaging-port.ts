import type { MessagingPort, SendTextResult } from '../../src/modules/messaging';

export interface SentMessage {
  to: string;
  body: string;
}

export interface SentTemplate {
  to: string;
  templateName: string;
  params: string[];
}

/**
 * Substitui o WhatsappCloudAdapter na suite automatizada — mesmo a conta
 * Meta estando liberada agora (Fase 5), teste automatizado nunca bate na
 * Graph API real (custo, instabilidade de rede, template aprovado
 * necessario). Validacao contra a API real fica manual, mesmo padrao do
 * Gemini/embedding.
 */
export class FakeMessagingPort implements MessagingPort {
  public readonly sentMessages: SentMessage[] = [];
  public readonly sentTemplates: SentTemplate[] = [];
  private counter = 0;

  async sendText(toPhoneE164: string, body: string): Promise<SendTextResult> {
    this.sentMessages.push({ to: toPhoneE164, body });
    this.counter += 1;
    return { externalId: `fake-wamid-${this.counter}` };
  }

  async sendTemplate(toPhoneE164: string, templateName: string, params: string[]): Promise<SendTextResult> {
    this.sentTemplates.push({ to: toPhoneE164, templateName, params });
    this.counter += 1;
    return { externalId: `fake-wamid-template-${this.counter}` };
  }
}

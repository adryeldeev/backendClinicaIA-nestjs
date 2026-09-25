import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../shared/config/env.schema';
import type { MessagingPort, SendTextResult } from '../ports/messaging.port';

const GRAPH_API_VERSION = 'v21.0';

@Injectable()
export class WhatsappCloudAdapter implements MessagingPort {
  private readonly logger = new Logger(WhatsappCloudAdapter.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  async sendText(toPhoneE164: string, body: string): Promise<SendTextResult> {
    const phoneNumberId = this.config.get('WHATSAPP_PHONE_NUMBER_ID', { infer: true });
    const accessToken = this.config.get('WHATSAPP_ACCESS_TOKEN', { infer: true });

    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: toPhoneE164,
          type: 'text',
          text: { body },
        }),
      },
    );

    const payload = (await response.json()) as {
      messages?: Array<{ id: string }>;
      error?: { message?: string };
    };

    if (!response.ok || !payload.messages?.[0]?.id) {
      const reason = payload.error?.message ?? `HTTP ${response.status}`;
      this.logger.error(`Falha ao enviar mensagem via WhatsApp Cloud API: ${reason}`);
      throw new Error(`whatsapp_send_failed: ${reason}`);
    }

    return { externalId: payload.messages[0].id };
  }

  async sendTemplate(toPhoneE164: string, templateName: string, params: string[]): Promise<SendTextResult> {
    const phoneNumberId = this.config.get('WHATSAPP_PHONE_NUMBER_ID', { infer: true });
    const accessToken = this.config.get('WHATSAPP_ACCESS_TOKEN', { infer: true });

    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: toPhoneE164,
          type: 'template',
          template: {
            name: templateName,
            language: { code: 'pt_BR' },
            components:
              params.length > 0
                ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }]
                : [],
          },
        }),
      },
    );

    const payload = (await response.json()) as {
      messages?: Array<{ id: string }>;
      error?: { message?: string };
    };

    if (!response.ok || !payload.messages?.[0]?.id) {
      const reason = payload.error?.message ?? `HTTP ${response.status}`;
      this.logger.error(`Falha ao enviar template '${templateName}' via WhatsApp Cloud API: ${reason}`);
      throw new Error(`whatsapp_send_template_failed: ${reason}`);
    }

    return { externalId: payload.messages[0].id };
  }
}

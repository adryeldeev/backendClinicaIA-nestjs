import { createHmac, randomUUID } from 'node:crypto';

export interface BuildWebhookPayloadOptions {
  fromPhone: string; // digitos, sem "+", ex: '5585999990001'
  text: string;
  wamid?: string;
}

export interface BuiltWebhookPayload {
  payload: unknown;
  wamid: string;
}

export function buildWhatsappTextPayload(options: BuildWebhookPayloadOptions): BuiltWebhookPayload {
  const wamid = options.wamid ?? `wamid.TEST_${randomUUID()}`;

  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'test-entry',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: 'test-phone-id' },
              contacts: [{ profile: { name: 'Paciente Teste' }, wa_id: options.fromPhone }],
              messages: [
                {
                  from: options.fromPhone,
                  id: wamid,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: options.text },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  return { payload, wamid };
}

export function signPayload(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

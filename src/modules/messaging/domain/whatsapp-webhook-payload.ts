export interface WhatsappWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messages?: Array<{
          id: string;
          from: string;
          type: string;
          timestamp?: string;
          text?: { body: string };
        }>;
      };
    }>;
  }>;
}

export interface ExtractedInboundMessage {
  wamid: string;
  fromPhoneE164: string;
  type: string;
  text: string | null;
}

function toE164(rawPhone: string): string {
  return rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`;
}

export function extractInboundMessages(payload: WhatsappWebhookPayload): ExtractedInboundMessage[] {
  const messages: ExtractedInboundMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        messages.push({
          wamid: message.id,
          fromPhoneE164: toE164(message.from),
          type: message.type,
          text: message.type === 'text' ? (message.text?.body ?? null) : null,
        });
      }
    }
  }

  return messages;
}

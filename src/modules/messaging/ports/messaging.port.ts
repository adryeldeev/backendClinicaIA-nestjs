export const MESSAGING_PORT = Symbol('MESSAGING_PORT');

export interface SendTextResult {
  externalId: string;
}

export interface MessagingPort {
  sendText(toPhoneE164: string, body: string): Promise<SendTextResult>;
  /**
   * RN-18: fora da janela de 24h do WhatsApp so e possivel enviar template
   * aprovado. `params` preenche os parametros de corpo do template, na
   * ordem declarada no template (ex.: {{1}}, {{2}}...).
   */
  sendTemplate(toPhoneE164: string, templateName: string, params: string[]): Promise<SendTextResult>;
}

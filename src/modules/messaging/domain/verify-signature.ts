import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

/**
 * Valida a assinatura X-Hub-Signature-256 da Meta: HMAC-SHA256 do corpo
 * cru (bytes, nao o JSON re-serializado) usando o App Secret.
 */
export function isValidMetaSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const expectedHex = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const receivedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);

  const expected = Buffer.from(expectedHex, 'hex');
  const received = Buffer.from(receivedHex, 'hex');

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
}

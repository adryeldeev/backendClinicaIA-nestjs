import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isValidMetaSignature } from '../src/modules/messaging/domain/verify-signature';

const APP_SECRET = 'test-app-secret';

function sign(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('isValidMetaSignature', () => {
  it('aceita assinatura HMAC-SHA256 valida do corpo cru', () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const signature = sign(rawBody.toString('utf8'), APP_SECRET);

    expect(isValidMetaSignature(rawBody, signature, APP_SECRET)).toBe(true);
  });

  it('rejeita assinatura calculada com o app secret errado', () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const signature = sign(rawBody.toString('utf8'), 'secret-errado');

    expect(isValidMetaSignature(rawBody, signature, APP_SECRET)).toBe(false);
  });

  it('rejeita quando o corpo foi alterado apos a assinatura ser calculada', () => {
    const originalBody = JSON.stringify({ hello: 'world' });
    const signature = sign(originalBody, APP_SECRET);
    const tamperedBody = Buffer.from(JSON.stringify({ hello: 'world!' }));

    expect(isValidMetaSignature(tamperedBody, signature, APP_SECRET)).toBe(false);
  });

  it('rejeita header ausente', () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));

    expect(isValidMetaSignature(rawBody, undefined, APP_SECRET)).toBe(false);
  });

  it('rejeita header sem o prefixo sha256=', () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const rawHex = createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');

    expect(isValidMetaSignature(rawBody, rawHex, APP_SECRET)).toBe(false);
  });
});

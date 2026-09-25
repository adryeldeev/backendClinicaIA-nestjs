export class InvalidSignatureError extends Error {
  constructor() {
    super('Assinatura do webhook inválida ou ausente.');
    this.name = 'InvalidSignatureError';
  }
}

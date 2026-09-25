import { DomainError } from '../../../../shared/kernel/domain-error';

/** RN-18: fora da janela de 24h do WhatsApp, texto livre e recusado — mesma regra do DispatchOutboxJob, aqui checada sincronamente pro admin ver o 409 na hora, nao so depois no outbox. */
export class WindowExpiredError extends DomainError {
  readonly code = 'WINDOW_EXPIRED';
  readonly httpStatus = 409;

  constructor() {
    super('A janela de 24h do WhatsApp encerrou. Só é possível enviar via template aprovado.');
  }
}

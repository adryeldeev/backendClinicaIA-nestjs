import { Injectable } from '@nestjs/common';

/**
 * Abstrai "agora" atras de uma porta, mesmo padrao de LlmPort/MessagingPort
 * (token + interface) — testes de agendamento congelam o tempo com um
 * clock fixo em vez de ler o relogio real, eliminando de vez a classe de
 * bug de borda em que o horario gerado pelo teste e o "agora" lido pela
 * regra de negocio divergem por estarem a poucos milissegundos/segundos de
 * distancia um do outro (ex.: um cai no grid, o outro nao).
 */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

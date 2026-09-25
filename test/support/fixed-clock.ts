import type { Clock } from '../../src/shared/kernel/clock';

/** Clock de teste: sempre devolve o mesmo instante, ate ser explicitamente avancado. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  set(date: Date): void {
    this.current = date;
  }
}

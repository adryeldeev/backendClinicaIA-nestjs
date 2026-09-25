import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CatalogModule } from '../../../src/modules/catalog';
import { SchedulingModule } from '../../../src/modules/scheduling';
import { validateEnv } from '../../../src/shared/config/env.schema';
import { DatabaseModule } from '../../../src/shared/database/database.module';
import { CLOCK, type Clock } from '../../../src/shared/kernel/clock';
import { QueueModule } from '../../../src/shared/queue/bullmq.module';

/**
 * So o que a Fase 2 precisa (catalog + scheduling + infra compartilhada) —
 * nao a AppModule inteira, que traria conversation/messaging sem
 * necessidade nestes testes.
 *
 * `clock`: quando informado, substitui o SystemClock real — os testes de
 * agendamento congelam o tempo pra nao depender do relogio real (ver
 * FixedClock em test/support/fixed-clock.ts).
 */
export async function bootstrapSchedulingTestModule(clock?: Clock): Promise<TestingModule> {
  const builder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
      DatabaseModule,
      QueueModule,
      CatalogModule,
      SchedulingModule,
    ],
  });

  if (clock) {
    builder.overrideProvider(CLOCK).useValue(clock);
  }

  return builder.compile();
}

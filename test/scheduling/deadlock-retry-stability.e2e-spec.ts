import 'reflect-metadata';
import { TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HoldSlotUseCase, SlotTakenError } from '../../src/modules/scheduling';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { FixedClock } from '../support/fixed-clock';
import { bootstrapSchedulingTestModule } from './support/bootstrap-scheduling-module';
import { alignedFutureSlot, FIXED_NOW, seedSchedulingFixtures, SchedulingFixtures } from './support/seed-scheduling-fixtures';

/**
 * Achado do usuario (2026-09-24), pego pela propria suite (nao suposicao)
 * — sob corrida real pela mesma constraint EXCLUDE, o Postgres as vezes
 * devolve deadlock_detected (40P01) em vez de exclusion_violation (23P01)
 * direto (as duas transacoes precisam de ShareLock uma na outra pra
 * verificar a exclusao — comportamento documentado do Postgres, nao caso
 * hipotetico). Reproduzido em ~27% de 30 rodadas com um probe usando
 * Prisma cru, sem retry — vazava PrismaClientUnknownRequestError pro
 * AllExceptionsFilter em vez de SlotTakenError. `concurrency.e2e-spec.ts`
 * so dispara a corrida UMA vez por rodada — nao tinha amostra suficiente
 * pra pegar isso de forma confiavel. Este arquivo e a prova estatistica:
 * 30 rodadas da MESMA corrida real (nao 1), sempre 1 sucesso + 1
 * SlotTakenError, nunca erro cru — mantido como regressao permanente, nao
 * medicao descartavel.
 */
describe('holdSlot sob corrida real: retry de deadlock (40P01) nunca deixa erro cru vazar', () => {
  let moduleRef: TestingModule;
  let holdSlot: HoldSlotUseCase;
  let fixtures: SchedulingFixtures;

  beforeAll(async () => {
    moduleRef = await bootstrapSchedulingTestModule(new FixedClock(FIXED_NOW));
    const prisma = moduleRef.get(PrismaService);
    holdSlot = moduleRef.get(HoldSlotUseCase);
    fixtures = await seedSchedulingFixtures(prisma);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('30 rodadas de corrida real no mesmo slot — sempre 1 sucesso + 1 SlotTakenError, nunca erro cru', async () => {
    for (let i = 0; i < 30; i++) {
      const contestedSlot = alignedFutureSlot(FIXED_NOW, 20 + i);
      const results = await Promise.allSettled([
        holdSlot.execute({
          professionalId: fixtures.professionalId,
          procedureId: fixtures.procedureId,
          patientId: fixtures.patientAId,
          startsAt: contestedSlot,
          createdBy: 'agent',
        }),
        holdSlot.execute({
          professionalId: fixtures.professionalId,
          procedureId: fixtures.procedureId,
          patientId: fixtures.patientBId,
          startsAt: contestedSlot,
          createdBy: 'agent',
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

      expect(fulfilled, `iteracao ${i}: esperava 1 sucesso`).toHaveLength(1);
      expect(rejected, `iteracao ${i}: esperava 1 rejeicao`).toHaveLength(1);
      expect(rejected[0].reason, `iteracao ${i}: rejeicao deveria ser SlotTakenError, nao erro cru`).toBeInstanceOf(
        SlotTakenError,
      );
    }
  });
});

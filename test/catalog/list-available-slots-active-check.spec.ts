import 'reflect-metadata';
import { TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ListAvailableSlotsUseCase } from '../../src/modules/catalog';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { FixedClock } from '../support/fixed-clock';
import { bootstrapSchedulingTestModule } from '../scheduling/support/bootstrap-scheduling-module';
import { FIXED_NOW, seedSchedulingFixtures, SchedulingFixtures } from '../scheduling/support/seed-scheduling-fixtures';

/**
 * Achado da Etapa 3 (Fase 6, Caso 1): "desativar impede novo agendamento"
 * so vale se alguem de verdade checar `active` em algum lugar do caminho
 * de reserva. Antes desta correcao, ListAvailableSlotsUseCase (usado por
 * HoldSlotUseCase e por CreateManualAppointmentUseCase) nao checava nada
 * disso — um professionalId/procedureId desativado continuava gerando
 * candidatos normalmente.
 */
describe('ListAvailableSlotsUseCase — professional/procedure inativo', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let listAvailableSlots: ListAvailableSlotsUseCase;
  let fixtures: SchedulingFixtures;

  beforeAll(async () => {
    moduleRef = await bootstrapSchedulingTestModule(new FixedClock(FIXED_NOW));
    prisma = moduleRef.get(PrismaService);
    listAvailableSlots = moduleRef.get(ListAvailableSlotsUseCase);
    fixtures = await seedSchedulingFixtures(prisma);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  const fromUtc = FIXED_NOW;
  const toUtc = new Date(FIXED_NOW.getTime() + 7 * 24 * 60 * 60 * 1000);

  it('profissional ativo + procedimento ativo gera candidatos normalmente (baseline)', async () => {
    const slots = await listAvailableSlots.execute({
      professionalId: fixtures.professionalId,
      procedureId: fixtures.procedureId,
      fromUtc,
      toUtc,
    });
    expect(slots.length).toBeGreaterThan(0);
  });

  it('profissional DESATIVADO nao gera nenhum candidato, mesmo com regra de disponibilidade cobrindo o horario', async () => {
    await prisma.professional.update({ where: { id: fixtures.professionalId }, data: { active: false } });

    const slots = await listAvailableSlots.execute({
      professionalId: fixtures.professionalId,
      procedureId: fixtures.procedureId,
      fromUtc,
      toUtc,
    });

    expect(slots).toEqual([]);
  });

  it('procedimento DESATIVADO nao gera nenhum candidato, mesmo com o profissional ativo', async () => {
    // Reverte o teste anterior — cada teste deste arquivo precisa ser
    // independente, nao acumular estado do professional em cima do outro.
    await prisma.professional.update({ where: { id: fixtures.professionalId }, data: { active: true } });
    await prisma.procedure.update({ where: { id: fixtures.procedureId }, data: { active: false } });

    const slots = await listAvailableSlots.execute({
      professionalId: fixtures.professionalId,
      procedureId: fixtures.procedureId,
      fromUtc,
      toUtc,
    });

    expect(slots).toEqual([]);
  });
});

import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaAppointmentRepository } from '../../src/modules/scheduling/infrastructure/prisma-appointment.repository';
import { SlotTakenError } from '../../src/modules/scheduling/domain/errors/slot-taken.error';
import type { PrismaService } from '../../src/shared/database/prisma.service';

function deadlockError(): Prisma.PrismaClientUnknownRequestError {
  return new Prisma.PrismaClientUnknownRequestError(
    'Error occurred during query execution:\nConnectorError(... PostgresError { code: "40P01", message: "deadlock detected", ... })',
    { clientVersion: '6.19.3' },
  );
}

/**
 * Pedido explicito do usuario (2026-09-24): "o que acontece depois do teto
 * de 2 retentativas? Se o deadlock persistir, traduza para o mesmo erro de
 * conflito de dominio — o paciente precisa ver 'esse horario acabou de ser
 * ocupado', nunca 'erro interno'."
 *
 * Concorrencia real (deadlock-retry-stability.e2e-spec.ts) nao consegue
 * provar isso de forma deterministica — nao ha como FORCAR o deadlock
 * persistir alem do teto so com timing real. Teste unitario com um Prisma
 * fake que sempre falha resolve isso: prova o comportamento exato no
 * limite (3 tentativas, todas deadlock, nunca vaza cru), sem depender de
 * sorte de concorrencia.
 */
describe('holdSlot: deadlock persistente alem do teto de retentativas', () => {
  it('esgota as 3 tentativas (2 retentativas) e ainda traduz pra SlotTakenError, nunca erro cru', async () => {
    const create = vi.fn().mockRejectedValue(deadlockError());
    const fakePrisma = { appointment: { create } } as unknown as PrismaService;
    const repo = new PrismaAppointmentRepository(fakePrisma);

    await expect(
      repo.holdSlot({
        professionalId: 'prof-1',
        patientId: 'patient-1',
        procedureId: 'proc-1',
        startsAt: new Date(),
        endsAt: new Date(),
        holdExpiresAt: new Date(),
        createdBy: 'agent',
      }),
    ).rejects.toBeInstanceOf(SlotTakenError);

    expect(create).toHaveBeenCalledTimes(3); // 1 tentativa + 2 retentativas
  });
});

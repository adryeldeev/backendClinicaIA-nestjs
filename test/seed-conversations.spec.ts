import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { seedTestConversations } from '../prisma/seed-conversations';

const FIXTURE_PHONE_PREFIX = '+558599000000';

/**
 * Acrescimo 2 do contrato da Fase 1 (achado do usuario): o front precisa
 * recriar o cenario sozinho quantas vezes quiser, sem acumular lixo nem
 * tocar em dado que nao seja dele. Prova as duas garantias: idempotencia
 * (rodar 2x nao duplica) e isolamento (nunca mexe fora do proprio prefixo).
 */
describe('seedTestConversations — idempotencia (acrescimo 2 do contrato da Fase 1)', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rodar duas vezes nao duplica — sempre exatamente 6 conversas fixture', async () => {
    await seedTestConversations(prisma);
    const afterFirst = await prisma.patient.count({ where: { phoneE164: { startsWith: FIXTURE_PHONE_PREFIX } } });
    expect(afterFirst).toBe(6);

    await seedTestConversations(prisma);
    const afterSecond = await prisma.patient.count({ where: { phoneE164: { startsWith: FIXTURE_PHONE_PREFIX } } });
    expect(afterSecond).toBe(6);
  });

  it('nunca toca em paciente/conversa fora do proprio prefixo', async () => {
    const outsidePatient = await prisma.patient.create({ data: { phoneE164: `+${Date.now()}` } });
    const outsideConversation = await prisma.conversation.create({ data: { patientId: outsidePatient.id } });

    await seedTestConversations(prisma);
    await seedTestConversations(prisma);

    const stillThere = await prisma.conversation.findUnique({ where: { id: outsideConversation.id } });
    expect(stillThere).not.toBeNull();
  });

  it('cria os 6 estados nomeados esperados', async () => {
    await seedTestConversations(prisma);
    const patients = await prisma.patient.findMany({
      where: { phoneE164: { startsWith: FIXTURE_PHONE_PREFIX } },
      include: { conversations: { include: { messages: true } } },
    });
    expect(patients).toHaveLength(6);

    const byName = new Map(patients.map((p) => [p.name, p.conversations[0]]));
    const get = (name: string) => byName.get(name)!;
    expect(get('Fixture AWAITING_HUMAN').status).toBe('AWAITING_HUMAN');
    expect(get('Fixture BOT').status).toBe('BOT');
    expect(get('Fixture HUMAN').status).toBe('HUMAN');
    expect(get('Fixture Janela Aberta').windowExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(get('Fixture Janela Expirada').windowExpiresAt!.getTime()).toBeLessThan(Date.now());
    expect(get('Fixture Historico Longo').messages.length).toBeGreaterThan(20);
  });
});

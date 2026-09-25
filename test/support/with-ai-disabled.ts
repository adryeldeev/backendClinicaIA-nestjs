import type { PrismaService } from '../../src/shared/database/prisma.service';

/**
 * RN-25 e um interruptor GLOBAL de verdade — nao ha como testar isso
 * criando uma clinica "isolada", porque ManageClinicSettingsUseCase
 * sempre opera sobre "a clinica primaria" (a mais antiga por createdAt,
 * unica no sistema real). Tentar fabricar uma clinica artificialmente
 * antiga pra virar "a primaria" durante o teste NAO FUNCIONA de forma
 * confiavel: o tempo real so anda pra frente, entao uma execucao antiga
 * desta mesma suite (ou de uma sessao de debug anterior) sempre vence a
 * "corrida por ser mais antigo" contra qualquer tentativa nova — achado
 * real, nao hipotetico (visto rodando este arquivo repetidas vezes).
 *
 * A unica forma robusta: descobrir qual e a clinica primaria DE VERDADE
 * neste momento, guardar o valor atual dela, aplicar o `enabled` pedido,
 * rodar o teste, e restaurar o valor original em `finally` — mesmo se a
 * asserção do meio falhar. Sem isso, um teste que desliga a IA e nao
 * restaura quebra silenciosamente QUALQUER outro teste da suite inteira
 * que espera o bot responder.
 */
export async function withAiDisabled<T>(prisma: PrismaService, enabled: boolean, fn: () => Promise<T>): Promise<T> {
  const primaryClinic = await prisma.clinic.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
  const originalValue = primaryClinic.aiEnabled;

  await prisma.clinic.update({ where: { id: primaryClinic.id }, data: { aiEnabled: enabled } });
  try {
    return await fn();
  } finally {
    await prisma.clinic.update({ where: { id: primaryClinic.id }, data: { aiEnabled: originalValue } });
  }
}

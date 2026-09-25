import type { TestingModule } from '@nestjs/testing';
import { PurgeConversationsJob } from '../../src/modules/conversation/application/purge-conversations.job';
import { ReindexKnowledgeDocumentJob } from '../../src/modules/knowledge/application/reindex-knowledge-document.job';
import { DispatchOutboxJob } from '../../src/modules/messaging/application/dispatch-outbox.job';
import { ProcessInboundJob } from '../../src/modules/messaging/application/process-inbound.job';
import { ReprocessStuckTurnsJob } from '../../src/modules/messaging/application/reprocess-stuck-turns.job';
import { SendAppointmentReminderJob } from '../../src/modules/messaging/application/send-appointment-reminder.job';
import { ExpireHoldsJob } from '../../src/modules/scheduling/application/expire-holds.job';

/**
 * Espera as conexoes Redis de TODOS os Workers do BullMQ (todas as classes
 * que estendem WorkerHost no projeto) terminarem de conectar. Sem isso,
 * fechar o app rapido demais (comum em testes) pode acontecer antes da
 * conexao do Worker terminar de estabelecer.
 *
 * Ate a Fase 6/Etapa 2 so esperava ProcessInboundJob/DispatchOutboxJob
 * (os dois primeiros a existir, Fase 1) — todo teste e2e que so exercitava
 * messaging nunca notou os outros 4 workers (scheduling/conversation)
 * ficando sem essa espera. O primeiro teste admin de scheduling com
 * AppModule completo (Etapa 2) travou 30s no afterAll por causa exatamente
 * disso: ExpireHoldsJob nunca era esperado. Sempre que uma classe nova
 * `extends WorkerHost` for criada, adicionar aqui.
 */
export async function waitForQueueWorkersReady(moduleRef: TestingModule): Promise<void> {
  const jobs = [
    moduleRef.get(ProcessInboundJob),
    moduleRef.get(DispatchOutboxJob),
    moduleRef.get(ExpireHoldsJob),
    moduleRef.get(PurgeConversationsJob),
    moduleRef.get(ReprocessStuckTurnsJob),
    moduleRef.get(SendAppointmentReminderJob),
    moduleRef.get(ReindexKnowledgeDocumentJob),
  ];

  await Promise.all(jobs.map((job) => job.worker.waitUntilReady()));
}

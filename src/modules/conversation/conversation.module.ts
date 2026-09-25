import { InjectQueue } from '@nestjs/bullmq';
import { Module, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AgentModule } from '../agent';
import { CatalogModule } from '../catalog';
import { IdentityModule } from '../identity';
import { CLOCK, SystemClock } from '../../shared/kernel/clock';
import { QueueModule } from '../../shared/queue/bullmq.module';
import { registerRepeatableJob } from '../../shared/queue/register-repeatable-job';
import { CONVERSATION_PURGE_QUEUE, PURGE_CONVERSATIONS_JOB_ID } from '../../shared/queue/queue.tokens';
import { CreatePatientUseCase } from './application/create-patient.use-case';
import { EnsureHumanAssignedUseCase } from './application/ensure-human-assigned.use-case';
import { EscalateToHumanUseCase } from './application/escalate-to-human.use-case';
import { FindStuckConversationsUseCase } from './application/find-stuck-conversations.use-case';
import { GetConversationDetailUseCase } from './application/get-conversation-detail.use-case';
import { GetConversationResolutionMetricsUseCase } from './application/get-conversation-resolution-metrics.use-case';
import { GetConversationWindowUseCase } from './application/get-conversation-window.use-case';
import { GetOrCreateConversationUseCase } from './application/get-or-create-conversation.use-case';
import { GetPatientDetailUseCase } from './application/get-patient-detail.use-case';
import { HandleDebouncedMessageUseCase } from './application/handle-debounced-message.use-case';
import { ListConversationsUseCase } from './application/list-conversations.use-case';
import { PurgeConversationsJob } from './application/purge-conversations.job';
import { RecordAgentReplyUseCase } from './application/record-agent-reply.use-case';
import { RecordHumanMessageUseCase } from './application/record-human-message.use-case';
import { RecordInboundMessageUseCase } from './application/record-inbound-message.use-case';
import { ReleaseConversationUseCase } from './application/release-conversation.use-case';
import { SearchConversationsUseCase } from './application/search-conversations.use-case';
import { SearchPatientsUseCase } from './application/search-patients.use-case';
import { TakeoverConversationUseCase } from './application/takeover-conversation.use-case';
import { PrismaConversationRepository } from './infrastructure/prisma-conversation.repository';
import { PrismaHandoffTicketRepository } from './infrastructure/prisma-handoff-ticket.repository';
import { PrismaMessageRepository } from './infrastructure/prisma-message.repository';
import { PrismaPatientRepository } from './infrastructure/prisma-patient.repository';
import { ConversationsAdminController } from './interface/conversations.admin-controller';
import { PatientsAdminController } from './interface/patients.admin-controller';

const PURGE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h — expurgo nao e sensivel a minutos

@Module({
  // CatalogModule: aresta nova (RN-25 — HandleDebouncedMessageUseCase
  // precisa checar Clinic.aiEnabled). Permitida: catalog nao depende de
  // ninguem, nao fecha ciclo.
  imports: [AgentModule, CatalogModule, QueueModule, IdentityModule],
  controllers: [ConversationsAdminController, PatientsAdminController],
  providers: [
    PrismaPatientRepository,
    PrismaConversationRepository,
    PrismaMessageRepository,
    PrismaHandoffTicketRepository,
    GetOrCreateConversationUseCase,
    RecordInboundMessageUseCase,
    HandleDebouncedMessageUseCase,
    EscalateToHumanUseCase,
    GetConversationWindowUseCase,
    { provide: CLOCK, useClass: SystemClock },
    PurgeConversationsJob,
    FindStuckConversationsUseCase,
    ListConversationsUseCase,
    SearchConversationsUseCase,
    GetConversationDetailUseCase,
    TakeoverConversationUseCase,
    ReleaseConversationUseCase,
    SearchPatientsUseCase,
    CreatePatientUseCase,
    GetPatientDetailUseCase,
    EnsureHumanAssignedUseCase,
    RecordHumanMessageUseCase,
    RecordAgentReplyUseCase,
    GetConversationResolutionMetricsUseCase,
  ],
  exports: [
    GetOrCreateConversationUseCase,
    RecordInboundMessageUseCase,
    HandleDebouncedMessageUseCase,
    EscalateToHumanUseCase,
    GetConversationWindowUseCase,
    FindStuckConversationsUseCase,
    EnsureHumanAssignedUseCase,
    GetConversationDetailUseCase,
    RecordHumanMessageUseCase,
    RecordAgentReplyUseCase,
    GetConversationResolutionMetricsUseCase,
  ],
})
export class ConversationModule implements OnModuleInit {
  constructor(
    @InjectQueue(CONVERSATION_PURGE_QUEUE) private readonly purgeQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await registerRepeatableJob(this.purgeQueue, PURGE_CONVERSATIONS_JOB_ID, PURGE_CHECK_INTERVAL_MS);
  }
}

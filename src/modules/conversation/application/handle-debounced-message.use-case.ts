import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationStatus } from '@prisma/client';
import { RunOrchestratorTurnUseCase } from '../../agent';
import { ManageClinicSettingsUseCase } from '../../catalog';
import type { Env } from '../../../shared/config/env.schema';
import { redactForLog } from '../../../shared/kernel/redact-pii';
import { PrismaConversationRepository } from '../infrastructure/prisma-conversation.repository';
import { PrismaMessageRepository } from '../infrastructure/prisma-message.repository';
import { EscalateToHumanUseCase } from './escalate-to-human.use-case';

/** Secao 9 da SPEC.md: "historico enviado ao LLM e truncado nos ultimos 20 turnos". */
const HISTORY_TURNS_LIMIT = 20;

export type HandleDebouncedMessageResult =
  | { skipped: true; reason: 'human_takeover' | 'ai_disabled' | 'no_pending_message' | 'escalated' | 'llm_unavailable' }
  | { skipped: false; patientPhoneE164: string; reply: string };

@Injectable()
export class HandleDebouncedMessageUseCase {
  private readonly logger = new Logger(HandleDebouncedMessageUseCase.name);

  constructor(
    private readonly conversations: PrismaConversationRepository,
    private readonly messages: PrismaMessageRepository,
    private readonly orchestrator: RunOrchestratorTurnUseCase,
    private readonly escalateToHuman: EscalateToHumanUseCase,
    private readonly clinicSettings: ManageClinicSettingsUseCase,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async execute(conversationId: string): Promise<HandleDebouncedMessageResult> {
    const conversation = await this.conversations.findByIdWithPatient(conversationId);
    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }

    // TODAS as mensagens do paciente ainda nao processadas — nao so a
    // ultima (decisao 1 do plano da Fase 3: o debounce pode colapsar
    // varias mensagens numa so execucao do job).
    const unconsumed = await this.messages.findUnconsumedPatientMessages(conversationId);

    // RN-15: conversa em atendimento humano nunca recebe resposta
    // automatica. As mensagens sao marcadas consumidas mesmo assim — foram
    // vistas pelo sistema, so nao geram resposta; quando a conversa voltar
    // pra BOT (Fase 6), mensagens novas comecam um turno limpo.
    if (conversation.status === ConversationStatus.HUMAN) {
      this.logger.log(`Conversation ${conversationId} is HUMAN — skipping automatic reply.`);
      await this.messages.markConsumed(unconsumed.map((message) => message.id));
      return { skipped: true, reason: 'human_takeover' };
    }

    // RN-25: interruptor global — desligado, TODA conversa (independente
    // do proprio status) cai em atendimento humano, mesmo tratamento de
    // HUMAN acima. Checado depois do caso HUMAN (que ja cobre o proprio
    // cenario) e antes de qualquer chamada ao orquestrador.
    if (!(await this.clinicSettings.getAiEnabled())) {
      this.logger.log(`Conversation ${conversationId}: IA desligada globalmente (RN-25) — skipping automatic reply.`);
      await this.messages.markConsumed(unconsumed.map((message) => message.id));
      return { skipped: true, reason: 'ai_disabled' };
    }

    if (unconsumed.length === 0) {
      return { skipped: true, reason: 'no_pending_message' };
    }

    const history = await this.messages.findRecentHistory(conversationId, HISTORY_TURNS_LIMIT);

    const result = await this.orchestrator.execute({
      conversationId,
      patientId: conversation.patientId,
      history: history.map((message) => ({ role: message.role, content: message.content })),
      newMessages: unconsumed.map((message) => message.content),
    });

    // Achado no teste manual da Fase 3: llm_error e falha TRANSITORIA de
    // infraestrutura (503/429 do Gemini apos esgotar retry+fallback no
    // adapter), nao uma decisao do sistema — bem diferente de um guardrail
    // ou de MAX_ITERATIONS, que sao o sistema processando e concluindo que
    // deve escalar. Se marcassemos consumido e escalassemos aqui, um
    // soluco de alguns segundos do provedor viraria escalada permanente
    // pra humano — exatamente a "enxurrada na fila da recepcao" que
    // queremos evitar. As mensagens ficam disponiveis (nao consumidas) e a
    // conversa continua em BOT, pra a proxima mensagem do paciente (ou um
    // reprocessamento) tentar de novo do zero.
    if (result.outcome === 'escalate' && result.reason === 'llm_error') {
      // RN-16, segunda peca (achado do incidente de 2026-09-23): sem teto,
      // uma instabilidade sustentada do provedor faz ReprocessStuckTurnsJob
      // reenfileirar esta mesma conversa pra sempre, a cada tick, queimando
      // cota indefinidamente sem nunca escalar. O contador so mede turnos
      // CONSECUTIVOS terminados em llm_error — qualquer outro desfecho zera.
      const consecutiveFailures = await this.conversations.incrementConsecutiveLlmErrors(conversationId);
      const threshold = this.config.get('LLM_ERROR_ESCALATION_THRESHOLD', { infer: true });

      if (consecutiveFailures >= threshold) {
        this.logger.warn(
          `Conversation ${conversationId}: ${consecutiveFailures} falhas de LLM consecutivas (limite ${threshold}) — escalando pra humano em vez de reprocessar de novo (RN-16).`,
        );
        await this.messages.markConsumed(unconsumed.map((message) => message.id));
        await this.conversations.resetConsecutiveLlmErrors(conversationId);
        await this.escalateToHuman.execute({
          conversationId,
          reason: 'llm_error_max_retries',
          summary: `LLM indisponivel por ${consecutiveFailures} turnos consecutivos, apos esgotar retry/fallback em cada um.`,
        });
        return { skipped: true, reason: 'escalated' };
      }

      this.logger.error(
        `Conversation ${conversationId}: LLM indisponivel apos esgotar retry/fallback (falha ${consecutiveFailures}/${threshold}) — mensagens permanecem pendentes. ${result.summary}`,
      );
      return { skipped: true, reason: 'llm_unavailable' };
    }

    // Turno terminou em qualquer coisa que NAO seja llm_error — zera o
    // contador do RN-16 (o sistema progrediu, falhas antigas nao devem
    // continuar valendo contra o paciente).
    await this.conversations.resetConsecutiveLlmErrors(conversationId);

    // O turno fecha aqui independente do desfecho (resposta ou escalada
    // definitiva por guardrail/max_iterations).
    await this.messages.markConsumed(unconsumed.map((message) => message.id));

    if (result.outcome === 'escalate') {
      // RN-21: nunca log com conteudo clinico/PII cru. result.summary pode
      // embutir a mensagem do paciente (guardrail de entrada monta assim
      // de proposito, pro HandoffTicket ficar legivel) — achado concreto
      // desta fase, nao hipotetico.
      this.logger.warn(`Conversation ${conversationId} escalated: ${result.reason} — ${redactForLog(result.summary)}`);
      await this.escalateToHuman.execute({
        conversationId,
        reason: result.reason,
        summary: result.summary,
      });
      return { skipped: true, reason: 'escalated' };
    }

    // A Message(AGENT) NAO e criada aqui de proposito (achado do usuario,
    // contrato da Fase 1, correcao 2): criar a Message antes do
    // OutboxMessage existir deixaria uma janela em que, se o processo
    // morresse no meio, a resposta ficaria registrada no historico como se
    // tivesse sido enviada sem nunca ter sido enfileirada de verdade —
    // mesma classe de bug dos incidentes de reprocessamento desta semana
    // (passo interrompivel no meio). Quem cria a Message e RecordAgentReplyUseCase,
    // chamado pelo caller (ProcessInboundJob) DEPOIS de criar o
    // OutboxMessage, com o id ja em maos.
    return { skipped: false, patientPhoneE164: conversation.patient.phoneE164, reply: result.text };
  }
}

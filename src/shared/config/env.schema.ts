import { z } from 'zod';

const envSchema = z.object({
  // Banco / infra
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  // WhatsApp Cloud API
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_ACCESS_TOKEN: z.string().default(''),
  WHATSAPP_VERIFY_TOKEN: z.string().default(''),
  WHATSAPP_APP_SECRET: z.string().default(''),
  // Nome do template aprovado na Meta pro lembrete de 24h (RN-18: fora da
  // janela de 24h so aceita template, nunca texto livre). Precisa existir
  // e estar APROVADO no WhatsApp Manager antes de funcionar de verdade —
  // valor default e so um placeholder legivel, nao um template que já existe.
  WHATSAPP_REMINDER_TEMPLATE_NAME: z.string().default('lembrete_consulta_24h'),

  // LLM
  LLM_PROVIDER: z.enum(['gemini']).default('gemini'),
  GEMINI_API_KEY: z.string().default(''),
  // Lista ordenada separada por virgula (GeminiLlmAdapter tenta o primeiro;
  // em 429/5xx apos esgotar retry, ou 404, cai pro proximo). Achado no
  // teste manual da Fase 3: disponibilidade varia por modelo e por minuto
  // no free tier — gemini-2.5-flash/gemini-2.5-pro aparecem em
  // GET /v1beta/models mas sao recusados (404) em contas novas;
  // gemini-3.6-flash e gemini-flash-latest deram 503 (alta demanda);
  // gemini-3.5-flash e gemini-3-flash-preview responderam de forma
  // estavel na maior parte das tentativas.
  LLM_MODEL: z.string().default('gemini-3.5-flash,gemini-3-flash-preview'),
  LLM_MAX_ITERATIONS: z.coerce.number().int().positive().default(5),

  // Embeddings
  EMBEDDING_PROVIDER: z.enum(['gemini', 'local']).default('gemini'),
  // gemini-embedding-001 confirmado na mao (GET /v1beta/models + chamada
  // real a embedContent) — suporta outputDimensionality; testado
  // devolvendo exatamente 768 floats com esse parametro.
  EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  // Acoplado a coluna "embedding vector(768)" (schema.prisma + migration).
  // Nao e livremente configuravel: trocar isso sem migration+reingestao
  // trunca ou rejeita vetor silenciosamente. KnowledgeModule valida essa
  // premissa no boot (ver knowledge.module.ts).
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),

  // Regras de negocio
  CLINIC_TIMEZONE: z.string().default('America/Fortaleza'),
  MIN_LEAD_TIME_HOURS: z.coerce.number().int().nonnegative().default(2),
  MAX_LOOKAHEAD_DAYS: z.coerce.number().int().positive().default(60),
  HOLD_TTL_MINUTES: z.coerce.number().int().positive().default(10),
  LATE_CANCEL_HOURS: z.coerce.number().int().nonnegative().default(24),
  MESSAGE_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(3000),
  // Achado do usuario (2026-09-24): concorrencia do BullMQ e 1 por padrao
  // (nao configuravel pelo @Processor sem isso) — com 10 chamadas ao LLM
  // por conversa completa de agendamento (ver test/agent/llm-call-budget.
  // e2e-spec.ts), pico de segunda de manhã enfileira paciente atras de
  // paciente, sequencial. Default 5, nao 1: teto pensado pro pool de
  // conexao padrao do Prisma (formula oficial: cpus*2+1, tipicamente
  // pequeno numa maquina pequena) e pro rate limit do free tier do Gemini
  // (ver comentario de LLM_MODEL acima) — nao é um numero calibrado contra
  // producao real ainda, so mais seguro que 1. Ajustar depois de medir.
  INBOUND_QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(5),
  OUTBOX_QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(5),
  // RN-16 (job varredor): mensagem de paciente presa por llm_error (Fase 3
  // nao marca consumido nem escala, de proposito) so reprocessa sozinha
  // depois desse tempo, se o paciente nao mandar outra mensagem antes.
  STUCK_MESSAGE_REPROCESS_MINUTES: z.coerce.number().int().positive().default(15),
  // RN-16, segunda peca (achado do incidente de 2026-09-23 — ver CLAUDE.md):
  // sem teto, ReprocessStuckTurnsJob reenfileirava a mesma conversa a cada
  // tick pra sempre numa instabilidade sustentada do provedor, queimando
  // cota indefinidamente sem nunca escalar pra humano. Ao atingir esse
  // numero de turnos CONSECUTIVOS terminados em llm_error, escala em vez de
  // tentar de novo.
  LLM_ERROR_ESCALATION_THRESHOLD: z.coerce.number().int().positive().default(3),
  // Calibrado na mao contra o Gemini real (gemini-embedding-001, 4
  // documentos de exemplo) — 0.35 era chute puro e deixava passar QUALQUER
  // pergunta: ate "qual e a capital da Franca?" pontuou 0.47 contra a base
  // da clinica. Ver secao 11 da SPEC.md pra evidencia completa e a ressalva
  // de amostra pequena.
  RAG_SCORE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.65),
  CONVERSATION_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  // Flag destrutiva (redige conteudo de conversa e paciente irreversivelmente,
  // ver RN-22) — padrao false em TODO ambiente, producao liga explicitamente.
  // NAO usar z.coerce.boolean(): Boolean("false") e true em JS, entao
  // RETENTION_PURGE_ENABLED=false seria lido como ligado — achado real do
  // incidente de 2026-09-23 (ver CLAUDE.md). z.enum so aceita exatamente
  // "true"/"false", falha alto (ZodError) pra qualquer outro valor
  // ("1", "TRUE", "yes"...) em vez de aceitar sinonimo silenciosamente.
  RETENTION_PURGE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // Achado do front (contrato da Fase 1): sem isso, ninguem consegue testar
  // o caminho completo de envio sem risco de mandar WhatsApp REAL pra um
  // dos poucos numeros de teste da Meta. Desligado (padrao), DispatchOutboxJob
  // registra no log e marca SENT em vez de chamar a Cloud API — o outbox
  // enche, o front ve o ciclo de vida completo, nada sai de verdade. Mesmo
  // padrao de RETENTION_PURGE_ENABLED: z.enum, nunca z.coerce.boolean().
  OUTBOX_DISPATCH_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  // Painel administrativo
  ADMIN_ORIGIN: z.string().default('http://localhost:3001'),
  SESSION_COOKIE_NAME: z.string().default('clinica_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  SESSION_SECRET: z.string().min(1),
  LOGIN_RATE_LIMIT: z.string().default('5/15m'),
  // SEC-10 (achado do front, contrato da Fase 1): o painel faz polling de
  // ~5s por conversa aberta — sem deduplicar, isso gerava ~11 mil linhas de
  // AuditLog por dia por recepcionista, sem sinal nenhum (impossivel
  // distinguir "abriu a conversa" de "a tela se atualizou sozinha"). Dentro
  // desta janela, o mesmo (ator, entidade, acao) NAO gera uma segunda linha.
  AUDIT_DEDUP_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),

  // App
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Configuracao de ambiente invalida:\n${result.error.toString()}`);
  }
  return result.data;
}

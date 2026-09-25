# Spec Técnica — BACKEND — Agente de IA para Clínica (WhatsApp + Agendamento + RAG)

> Documento de especificação para implementação assistida por IA, fornecido pelo usuário. Cópia integral e literal, salva no repositório para que as referências a seções numeradas (usadas em `CLAUDE.md`, mensagens de commit e nomes de teste) sempre resolvam para um texto concreto, mesmo sem o histórico de chat original.

Este documento cobre APENAS o backend (`clinica-api`). O painel administrativo vive em um projeto separado (`clinica-web`), com spec própria. Nada de código de front aqui: sem React, sem Next.js, sem tela.

## 1. Objetivo

Sistema que atende pacientes de uma clínica via WhatsApp com um agente de IA capaz de:

- Responder dúvidas sobre a clínica usando RAG (preparo de exames, convênios aceitos, localização, procedimentos, horários de funcionamento).
- Agendar, remarcar e cancelar consultas de forma determinística e sem conflito de horários.
- Escalar para atendimento humano quando a conversa sair do escopo seguro.

Projeto pessoal / portfólio. Prioridade: arquitetura correta e testável acima de quantidade de features.

## 2. Escopo

### Dentro do MVP

- Canal WhatsApp via Cloud API oficial da Meta (número de teste, até 5 destinatários).
- Clínica genérica multi-profissional (não multi-tenant — uma clínica por instância).
- Agendamento com reserva temporária, confirmação explícita e controle de concorrência.
- RAG sobre base de conhecimento configurável.
- Escalada para humano com registro de ticket.
- Lembrete de consulta via template (fase final).
- API administrativa (`/api/admin/*`) que serve o painel da recepção — implementada aqui; as telas ficam no projeto `clinica-web`.

### Fora do MVP

- Multi-tenant.
- Integração com prontuário eletrônico (iClinic, Doctoralia, etc.).
- Pagamento / cobrança.
- Áudio, imagem e vídeo (apenas texto; mensagens de outros tipos geram resposta padrão + escalada).
- Autenticação de paciente por documento.

## 3. Decisões de arquitetura

| # | Decisão | Motivo |
|---|---|---|
| AD-00 | Monolito modular | Um processo, um deploy, uma transação de banco. Código organizado por módulo de negócio com fronteira explícita (seção 6), não por camada global. Agendamento consistente é trivial assim e doloroso distribuído. |
| AD-01 | Ports & Adapters (Hexagonal) dentro de cada módulo | O canal (WhatsApp) é um adapter. O domínio não conhece a Meta. Permite trocar/adicionar canal sem tocar no núcleo. |
| AD-02 | Agente único com tool calling, não árvore de intents | Menos código, mais natural. Router entra só se o custo de token virar problema. |
| AD-03 | O LLM conversa, o código decide | Toda escrita (reserva, confirmação, cancelamento) passa por validação determinística em serviço de domínio. O LLM nunca grava direto. |
| AD-04 | Agendamento como máquina de estados explícita | Evita o agente "esquecer" etapas ou agendar com dados incompletos. |
| AD-05 | Saga com compensação para reserva de slot | HOLD com TTL → CONFIRMED, ou liberação automática. Evita slot travado por conversa abandonada. |
| AD-06 | Idempotência por wamid | Webhook do WhatsApp reentrega. Sem isso o paciente agenda duas vezes. |
| AD-07 | Outbox + fila | Webhook responde 200 em <1s; o processamento com LLM (3–10s) é assíncrono. |
| AD-08 | Postgres + pgvector como único banco | Dado relacional e vetorial no mesmo lugar. Sem vector DB dedicado nesse volume. |
| AD-09 | Dado volátil nunca vem do RAG | Preço, convênio, horário disponível e agenda vêm de tool que lê o banco. RAG só para texto estável. |
| AD-10 | Anti-Corruption Layer na agenda | Mesmo usando tabela própria no MVP, o domínio fala com uma interface CalendarPort. Integração externa futura é só mais um adapter. |
| AD-11 | Todo horário armazenado em UTC, apresentado em America/Fortaleza | Bug clássico de agendamento. Conversão só na borda. |
| AD-12 | Front e backend são dois projetos independentes, em pastas separadas | Pastas, package.json, .env e processos distintos. O front nunca abre conexão com o banco nem segura chave de terceiro. Nada de Next.js fullstack com Server Action chamando Prisma. Detalhes na seção 5. |
| AD-13 | Superfície pública do webhook isolada da API administrativa | Rotas, autenticação e rate limit completamente distintos. O que a Meta chama não compartilha middleware com o que a recepção usa. |

## 4. Stack

```
Runtime      Node.js 22 + TypeScript (strict)
Framework    NestJS
ORM          Prisma
Banco        PostgreSQL 16 + extensão pgvector
Fila/Cache   Redis (BullMQ)
LLM          Gemini (free tier) via porta LlmPort — trocável
Embeddings   Gemini text-embedding OU fastembed local (ver EMBEDDING_PROVIDER)
Canal        WhatsApp Cloud API (Graph API v21+)
Testes       Vitest (unit + integração)
Infra local  Docker Compose (Postgres + Redis, persistentes) + Cloudflare Tunnel (webhook)
```

> **Nota de implementação (achado do usuário, 2026-09-23):** a stack original previa Testcontainers para os testes de integração — nunca foi configurado. Os 172 testes e2e/integração deste projeto conectam nos containers Postgres/Redis persistentes do `docker-compose.yml`, não em instâncias efêmeras por execução. `test/support/global-setup.ts` (vitest `globalSetup`) trunca e re-semeia o banco uma vez por `npx vitest run`, mantendo cada rodada isolada de rodadas anteriores sem precisar de Testcontainers. Isso é o comportamento real de hoje — não uma decisão registrada como pendência; se Testcontainers (isolamento por execução, sem depender de containers de longa duração) voltar a ser o destino desejado, é mudança de infraestrutura de teste a avaliar separadamente, não algo já entregue.
>
> **Isolamento suite × aplicação (achado do usuário, 2026-09-23 — dois incidentes no mesmo dia):** até aqui, a suite e a aplicação rodando localmente (`npm run start:dev`) apontavam para o MESMO banco Postgres (`clinica`) e o MESMO Redis (DB lógico 0) — não só o mesmo container, o mesmo dado. Um boot manual da aplicação e uma rodada de teste concorrentes disputavam a mesma fila/tabela: fixture de teste órfã sendo varrida pelo `ReprocessStuckTurnsJob` de uma aplicação real (queimando cota de Gemini de verdade), e vice-versa. Resolvido sem Testcontainers: a suite usa um banco Postgres **dedicado** (`clinica_test`, criado via `docker/init-test-db.sql` no mesmo container Postgres, migrado à parte) e um índice de Redis **dedicado** (`SELECT 1`, via `REDIS_URL=redis://localhost:6379/1`) — mesmos processos de infraestrutura, dados completamente isolados. Fonte única desses dois valores: `test/support/test-env.ts`, aplicado via `vitest.config.ts` (`test.env`) antes de qualquer arquivo de teste subir `AppModule`. O CI (que já sobe serviços Postgres/Redis próprios e efêmeros por execução) usa os mesmos nomes por consistência, não por necessidade — lá nada mais disputa o mesmo container.

Sem SDK de framework de agente (LangChain, LlamaIndex etc.). O orquestrador é código próprio — o objetivo do projeto é justamente exercitar os padrões.

## 5. Separação front / backend

### Topologia

Dois projetos independentes, em pastas irmãs. Cada um com `package.json`, `.env`, `node_modules` e processo próprios.

```
projetocomRAG-IA/
  clinica-api/   (NestJS)    → porta 3000    ← ESTE PROJETO
  clinica-web/   (Next.js)   → porta 3001    ← projeto separado, spec própria
```

Este projeto expõe duas superfícies, deliberadamente isoladas uma da outra:

```
clinica-api
  ├── superfície PÚBLICA      /webhooks/*      ← só a Meta chama
  │     autenticação: assinatura HMAC X-Hub-Signature-256
  │     sem sessão, sem cookie, sem CORS
  │
  └── superfície ADMIN        /api/admin/*     ← só o painel chama
        autenticação: sessão em cookie httpOnly
        CORS restrito, rate limit, RBAC
```

Banco, Redis, chaves da Meta e do provedor de LLM são acessíveis apenas por este projeto. O painel nunca fala com nada além desta API, sempre por HTTP.

O ponto não é a pasta, é o processo. Duas pastas dentro do mesmo runtime Next.js não separariam nada: uma Server Action que importa o Prisma client roda no mesmo processo que serve o HTML, com as mesmas variáveis de ambiente. A fronteira existe porque são dois node diferentes, com dois `.env` diferentes, e um deles não tem `DATABASE_URL`.

Não crie pasta de front aqui. Se este projeto ganhar um diretório `web/`, `frontend/` ou `client/`, a separação foi desfeita.

### Regras de fronteira (não negociáveis)

- **SEC-01** — O front nunca acessa o banco. Toda leitura e escrita dele passa por esta API. Como o front é outro projeto, isso é garantido por construção — desde que esta API não entregue atalho.
- **SEC-02** — Nenhum segredo sai desta API em resposta. Nunca devolva token de terceiro, string de conexão nem variável de ambiente em payload, nem em rota de debug.
- **SEC-02b** — Este projeto tem o seu próprio `.env`, com `DATABASE_URL` e as chaves. Ele nunca é compartilhado com o projeto do front.
- **SEC-03** — Autorização é sempre no servidor. O front esconde o botão; a API nega a requisição. Esconder no front sem negar na API é vulnerabilidade, não UX.
- **SEC-04** — Sessão em cookie httpOnly, Secure, SameSite=Lax. Nunca JWT em localStorage — XSS rouba, e aqui o que vaza é dado de saúde.
- **SEC-05** — CORS com allowlist explícita de origem (`ADMIN_ORIGIN`), `credentials: true`. Nunca `origin: '*'`.
- **SEC-06** — O webhook público não compartilha guard, middleware nem rate limiter com a API admin. Se a superfície pública for comprometida, ela não carrega sessão de ninguém.
- **SEC-07** — Nenhum dado de paciente em query string ou path parameter legível (`/consultas?cpf=...`). Query string vaza em log de proxy, histórico e header Referer. Identificadores são UUID; filtros sensíveis vão no corpo de um POST.
- **SEC-08** — Rate limit obrigatório em login (5 tentativas / 15 min / IP+e-mail, só falha conta — ver CLAUDE.md) e nas rotas que listam pacientes.
- **SEC-09** — Headers de segurança no painel: CSP sem `unsafe-inline`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- **SEC-10** — Todo **evento de acesso** a dado de paciente pelo painel gera um `AuditLog` (quem, o quê, quando) — não toda requisição HTTP. **Reescrita (achado do front, contrato da Fase 1, 2026-09-24):** o painel faz polling de ~5s por conversa aberta; sem deduplicar, isso gerava ~11 mil linhas/dia/recepcionista, indistinguíveis entre "abriu a conversa" e "a tela se atualizou sozinha" — auditoria com esse volume sem sinal não serve como evidência de nada. Dentro de `AUDIT_DEDUP_WINDOW_SECONDS` (padrão 60s, ver seção 14), o mesmo `(ator, entidade, ação)` não gera uma 2ª linha — a linha original já é a evidência de quando o acesso começou. Reabrir a mesma entidade depois da janela gera uma linha nova (evento de acesso distinto). LGPD exige rastreabilidade de acesso a dado sensível, não uma linha por requisição HTTP.

### RBAC

| Papel | Pode |
|---|---|
| ADMIN | Tudo: usuários, catálogo, base de conhecimento, todas as agendas. |
| RECEPCAO | Agendas de todos, assumir conversas escaladas, cadastrar paciente. Não mexe em usuários nem no catálogo. |
| PROFISSIONAL | Apenas a própria agenda e os próprios pacientes. Filtro aplicado na query, não no front. |

O `User` tem `professionalId` opcional. Quando o papel é PROFISSIONAL, toda consulta de agenda recebe `WHERE professionalId = session.professionalId` no repositório, não no controller — assim nenhuma rota nova esquece o filtro.

### Contrato da API administrativa

Estes são os endpoints que o projeto `clinica-web` vai consumir. Implementar exatamente com estes caminhos e verbos — a spec do front assume este contrato.

| Método | Rota | Papéis | Observação |
|---|---|---|---|
| POST | `/api/admin/auth/login` | público | `{email, password}` → 204 + Set-Cookie. Rate limit. |
| POST | `/api/admin/auth/logout` | autenticado | Revoga a sessão. |
| GET | `/api/admin/auth/me` | autenticado | `{id, name, email, role, professionalId, timezone}` — `timezone` (⚠️ novo, achado do usuário 2026-09-25, pendente desde o primeiro dia) é `CLINIC_TIMEZONE` (env, seção 14), não dado por usuário — só uma clínica por deploy. A agenda depende dele pra renderizar `startsAt` (sempre UTC) como horário local. |
| GET | `/api/admin/appointments` | todos | Query: `from`, `to` (ISO 8601, **obrigatórios** — diferente do `limit` da Fase 1: não existe pedido legítimo sem período, uma tela de calendário sempre sabe o intervalo que exibe), `professionalId` (opcional; PROFISSIONAL recebe só a própria agenda, ignora o valor pedido — critério de aceite #14). `to` não pode ser anterior a `from`, nem o intervalo passar de 92 dias — os dois rejeitam com 400 (achado do usuário, 2026-09-25: antes, invertido devolvia 200 com lista vazia, silenciando erro de cálculo de data da tela; sem teto, um intervalo aberto permitia pedir uma década de agenda numa chamada). Resposta: array de `Appointment` (`id, professionalId, patientId, procedureId, startsAt, endsAt, status, holdExpiresAt, cancelReason, lateCancellation, createdBy, reminderSentAt, version, createdAt, updatedAt`) com `professional: {id, name}` embutido. |
| POST | `/api/admin/appointments` | ADMIN, RECEPCAO | `{patientId, professionalId, procedureId, startsAt}` — criação manual, já `CONFIRMED` (não passa pelo hold de 10min do fluxo do agente). Resposta 201: `{appointmentId}`. |
| POST | `/api/admin/appointments/:id/cancel` | todos | `{reason?}` (⚠️ renomeado de `motivo`, achado do usuário 2026-09-25 — quebra de contrato deliberada, feita agora porque nada consome a rota ainda). Corpo é opcional de verdade: requisição sem `Content-Type: application/json` também funciona (achado do usuário, mesmo dia — `parseDto` tratava corpo ausente como erro, mesmo com todo campo opcional). PROFISSIONAL só cancela consulta da própria agenda (403 `APPOINTMENT_OUT_OF_SCOPE` senão). Resposta 200, sem corpo. |
| POST | `/api/admin/appointments/:id/reschedule` | todos | `{newStartsAt}` (⚠️ renomeado de `novoStartsAt`, mesmo achado acima). Mesma saga da seção 10. Resposta 200: `{appointmentId}` (da consulta NOVA — a antiga foi cancelada com `cancelReason:'Remarcado'`). |
| GET | `/api/admin/availability` | todos | Query: `professionalId`, `procedureId`, `from`, `to` — os 4 obrigatórios (não dá pra calcular disponibilidade sem saber de quem/o quê). Mesma checagem de intervalo invertido/teto de 92 dias do `GET /appointments` acima (mesmo controller, mesmo buraco — achado do usuário). Resposta: array de `{startsAt, endsAt}` (slots livres para criação manual). |
| GET | `/api/admin/conversations` | ADMIN, RECEPCAO | Query: `status` (múltiplos, separados por vírgula — ex. `status=BOT,HUMAN`; ausente = todas ⚠️), `limit` (opcional — padrão do servidor 50, teto 100, acima disso rejeita; correção 2026-09-24: "paginação obrigatória" significa "a lista nunca é ilimitada", não "todo chamador precisa declarar o tamanho"), `cursor` (opcional, ausente = 1ª página). Resposta: `{items, nextCursor}`. Cada item inclui `lastMessage: {id, role, content, createdAt, outboxMessage: {status}}` (última mensagem, numa única query — sem N+1) e `assignedUser: {id, name} | null`. Paginação por keyset em `(updatedAt DESC, id DESC)` — `updatedAt` sozinho não é chave estável (uma conversa que recebe mensagem nova muda de posição), por isso o cursor combina os dois. Consequência aceita: um item pode mudar de página entre duas chamadas se a conversa dele for atualizada no meio da rolagem — aceitável para caixa de entrada, registrado aqui de propósito. **Nunca inclui `context`** (SEC-02, achado do usuário 2026-09-24 — dados coletados parciais do paciente, removido na origem via `omit` do Prisma, não confiar em o front descartar). |
| GET | `/api/admin/conversations/:id` | ADMIN, RECEPCAO | Histórico completo. Cada mensagem inclui `outboxMessage: {status, sentAt, lastError} \| null` (status de entrega) e `authorUser: {id, name} \| null` (quem mandou, quando é `HUMAN`). **Nunca inclui `context`** na conversa nem **`toolCalls`** em nenhuma mensagem (SEC-02, mesmo achado acima — `toolCalls` carrega identificador interno e o raciocínio do modelo). `outboxMessage.status ∈ {PENDING, SENT, FAILED, SKIPPED}` — `SENT` só significa que a WhatsApp Cloud API aceitou; `SKIPPED` é modo de desenvolvimento com `OUTBOX_DISPATCH_ENABLED=false` (nunca foi enviada de verdade, front deve mapear como não entregue, nunca como entregue). |
| POST | `/api/admin/conversations/search` | ADMIN, RECEPCAO | `{query, limit?, cursor?}` no corpo (SEC-07) — busca por nome/telefone do paciente. Alinhado ao mesmo contrato do `GET /api/admin/conversations` (achado do usuário, 2026-09-24: antes devolvia array puro, sem paginação, sem `lastMessage` por item — front tinha que tratar como formato diferente sem necessidade real): `limit` opcional (padrão 50, teto 100), resposta `{items, nextCursor}`, cada item no mesmo formato do item da lista (inclui `lastMessage`, nunca `context` — mesma nota de SEC-02 acima). |
| POST | `/api/admin/conversations/:id/takeover` | ADMIN, RECEPCAO | `BOT` **ou** `AWAITING_HUMAN` → `HUMAN` ⚠️ (antes só aceitava `AWAITING_HUMAN`). Seta `assignedUserId` com quem assumiu. |
| POST | `/api/admin/conversations/:id/messages` | ADMIN, RECEPCAO | `{body}` → cria o `OutboxMessage` e SÓ DEPOIS a `Message` (com `outboxMessageId` e `authorUserId` já preenchidos na criação — nunca um passo separado depois, ver nota de correção abaixo), então enfileira no outbox. Rejeita 409 se a janela de 24h expirou. RN-26: se a conversa estava em `BOT` (ou `AWAITING_HUMAN`), vira `HUMAN` automaticamente (assunção implícita) e atualiza `assignedUserId` — mesmo se já estava `HUMAN` com outra pessoa assumida (RN-26 estendida, ver seção 12). |
| POST | `/api/admin/conversations/:id/release` | ADMIN, RECEPCAO | HUMAN → BOT. Limpa `assignedUserId`. |
| POST | `/api/admin/patients/search` | ADMIN, RECEPCAO | `{query}` no corpo, por SEC-07. |
| POST | `/api/admin/patients` | ADMIN, RECEPCAO | ⚠️ Novo (achado do usuário, 2026-09-25) — cadastro manual pela recepção, quem chega sem nunca ter mandado WhatsApp. `{name, phoneE164, birthDate?, insuranceId?}` — `name`/`phoneE164` obrigatórios. `phoneE164` é **normalizado no servidor**, nunca depende da tela mandar já formatado (aceita com pontuação/espaço, com ou sem código do país). Telefone duplicado responde 409 `PATIENT_PHONE_ALREADY_REGISTERED` com `error.details.existingPatientId` — o caso mais comum do balcão é a pessoa já ter cadastro de uma conversa por WhatsApp; a tela oferece "abrir cadastro existente" em vez de só "falhou". Resposta 201: o `Patient` criado. |
| GET | `/api/admin/patients/:id` | ADMIN, RECEPCAO | ⚠️ Novo — detalhe do paciente. 404 `PATIENT_NOT_FOUND` se não existir. |
| GET | `/api/admin/patients/:id/appointments` | ADMIN, RECEPCAO | ⚠️ Novo — `{upcoming: Appointment[], past: Appointment[]}`, TODOS os status (não só `CONFIRMED` — diferente da tool do agente `consultar_minhas_consultas`). Servido pelo módulo `scheduling` (dono de `Appointment`), não `conversation` (dono de `Patient`, onde o resto de `/patients/*` mora) — o front bate na URL, não precisa saber qual módulo atende (mesma decisão já usada em `catalog.admin-controller.ts` e `admin-messages.admin-controller.ts`). `id` de paciente inexistente devolve listas vazias, nunca 404 — `scheduling` não é dono de `Patient` pra validar existência; o front já checou via `GET /patients/:id` antes de chegar aqui. |
| GET/POST/PUT | `/api/admin/knowledge` | ADMIN | CRUD de documentos. POST/PUT são assíncronos: 202 + `status:'PENDING'`, chunking+embedding roda em job (ver seção 11). |
| POST | `/api/admin/knowledge/:id/reindex` | ADMIN | Rechunk + reembedding. Assíncrono (202), 409 se já existe rascunho pendente/rodando para o mesmo documento. |
| POST | `/api/admin/knowledge/test-search` | ADMIN | `{pergunta}` → top 5 candidatos com score real e `passesThreshold`, sem o corte de `RAG_SCORE_THRESHOLD` — ferramenta de calibração, não usada pelo agente. |
| GET | `/api/admin/catalog/professionals` | todos | ⚠️ Achado do usuário (2026-09-25): antes ADMIN-only — bug de RBAC, RECEPCAO não conseguia filtrar nem criar consulta manual sem a lista. |
| POST/PUT | `/api/admin/catalog/professionals` | ADMIN | |
| GET | `/api/admin/catalog/procedures` | todos | Mesmo achado acima. |
| POST/PUT | `/api/admin/catalog/procedures` | ADMIN | |
| GET/POST/PUT/DELETE | `/api/admin/catalog/availability` | ADMIN | Regras e exceções — configuração da clínica (quando um profissional atende, bloqueio de data), não leitura de agenda. RECEPCAO lê disponibilidade por `GET /availability` (calcula slot livre), nunca pelas regras cruas. |
| GET/PUT | `/api/admin/settings/ai-enabled` | ADMIN | RN-25: interruptor global. `PUT {enabled: boolean}`. Desligado, toda mensagem nova cai em atendimento humano na hora, independente do `status` de cada conversa. |
| GET | `/api/admin/metrics` | ADMIN, RECEPCAO | Métricas de resolução por período. Query opcional `from`/`to` (ISO 8601); sem elas, padrão é o mês corrente (dia 1 00:00 UTC até agora). Resposta: total de conversas, quantas foram concluídas sem escalada para humano, agendamentos/remarcações/cancelamentos que o agente realizou, e motivos de escalada agrupados por quantidade. Dados vêm de `Conversation`, `HandoffTicket` e `Appointment.createdBy` — nunca soma dado de mais de um período nem faz join direto entre módulos (cada módulo dono da sua fatia, seção 6). |

> **Semântica de `/api/admin/metrics` (Fase 6):** "agendamentos/remarcações/cancelamentos que o agente realizou" são atribuídos **pela origem do agendamento** (`Appointment.createdBy`), não por quem executou a ação de cancelar/remarcar depois — cancelamento e remarcação não criam linha nova, só mudam status na existente, então não há como saber quem clicou sem um campo adicional. Decisão explícita: se a recepção cancelar um agendamento que o bot fez, ainda conta como "cancelamento do agente" (mede o destino do que o agente reservou, não quem executou a ação por último). `createdBy` é setado em `HoldSlotUseCase` (`'agent'` — tool do agente e `RescheduleAppointmentUseCase`) e em `CreateManualAppointmentUseCase`/`AdminRescheduleAppointmentUseCase` (`'human'` — painel). "Remarcação" é identificada por `cancelReason = 'Remarcado'` (RN-13); "cancelamento" é qualquer outro `status = CANCELLED`.

> **Contrato de `/api/admin/conversations` — achados do front (2026-09-24), a SPEC.md estava desatualizada e o front leu o código-fonte pra descobrir o contrato real. Registrado aqui pra não acontecer de novo:**
>
> - **Ordem de escrita Message↔OutboxMessage:** o `OutboxMessage` é criado **primeiro**; o `id` dele é passado na própria criação da `Message` (`outboxMessageId`), nunca um `UPDATE` depois. Se o processo morrer entre os dois passos, o outbox já existe e **será despachado** — o pior caso é a `Message` não aparecer no histórico, nunca uma resposta "fantasma" que consta como enviada sem nunca ter sido enfileirada. Mesma classe de bug dos incidentes de reprocessamento de 2026-09-23 (passo interrompível no meio) — ver `RecordAgentReplyUseCase`/`RecordHumanMessageUseCase`.
> - **⚠️ MUDANÇAS DE CONTRATO (2026-09-24)**, quebram quem já chamava o endpoint anterior — sem problema prático porque o front (`clinica-web`) é o único consumidor e está sendo reescrito:
>   1. `GET /api/admin/conversations` sem `status`: antes devolvia só `AWAITING_HUMAN` (fila padrão); agora devolve **todas**.
>   2. `limit` passou de inexistente para **opcional com padrão/teto do servidor** (50/100) — sem paginação, `status=BOT` devolvia toda conversa que já existiu, ficando mais lento a cada dia até a tela parar de carregar. **Correção (2026-09-24):** a primeira versão exigia `limit` explícito e quebrou com `z.coerce.number()` recebendo `undefined` (`Number(undefined)` é NaN, mensagem "Expected number, received nan" — mesma família de armadilha do `z.coerce.boolean()` já documentada na seção 14). Fixado com `.default(50)`, que nunca roda a coerção sobre `undefined`.

Formato de erro, uniforme em todas as rotas:

```json
{ "error": { "code": "SLOT_TAKEN", "message": "Esse horário acabou de ser ocupado." } }
```

`error.details` (⚠️ novo, achado do usuário 2026-09-25) é opcional — presente só nos poucos erros que precisam devolver um dado extra pra tela decidir a próxima ação, nunca detalhe interno (SEC-02 continua valendo). Hoje só `PATIENT_PHONE_ALREADY_REGISTERED` usa (`{existingPatientId}`):

```json
{ "error": { "code": "PATIENT_PHONE_ALREADY_REGISTERED", "message": "Já existe um paciente cadastrado com esse telefone.", "details": { "existingPatientId": "uuid" } } }
```

### Catálogo de códigos de erro

Todo `DomainError` do projeto, com o `httpStatus` real (`shared/kernel/domain-error.ts` + cada `*.error.ts`). Registrado aqui porque o front já precisou de `INVALID_CONVERSATION_TRANSITION` e `CONVERSATION_NOT_FOUND` e os descobriu lendo o código-fonte — isso é falha de documentação nossa, não algo a adiar de novo.

| Código | HTTP | Módulo |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | identity |
| `SESSION_EXPIRED` | 401 | identity |
| `LOGIN_RATE_LIMITED` | 429 | identity |
| `ADMIN_ALREADY_EXISTS` | 409 | identity |
| `EMAIL_ALREADY_REGISTERED` | 409 | identity |
| `CONVERSATION_NOT_FOUND` | 404 | conversation |
| `INVALID_CONVERSATION_TRANSITION` | 409 | conversation |
| `PATIENT_NOT_FOUND` | 404 | conversation |
| `PATIENT_PHONE_ALREADY_REGISTERED` | 409 | conversation — carrega `details.existingPatientId` |
| `APPOINTMENT_NOT_FOUND` | 404 | scheduling |
| `SLOT_TAKEN` | 409 | scheduling |
| `INVALID_SLOT` | 400 | scheduling |
| `HOLD_EXPIRED` | 409 | scheduling |
| `NOT_APPOINTMENT_OWNER` | 403 | scheduling |
| `APPOINTMENT_OUT_OF_SCOPE` | 403 | scheduling |
| `PROFESSIONAL_USER_MISCONFIGURED` | 403 | scheduling |
| `PROFESSIONAL_NOT_FOUND` | 404 | catalog |
| `PROCEDURE_NOT_FOUND` | 404 | catalog |
| `CLINIC_NOT_FOUND` | 404 | catalog |
| `AVAILABILITY_RULE_NOT_FOUND` | 404 | catalog |
| `AVAILABILITY_EXCEPTION_NOT_FOUND` | 404 | catalog |
| `WINDOW_EXPIRED` | 409 | messaging |
| `KNOWLEDGE_DOCUMENT_NOT_FOUND` | 404 | knowledge |
| `REINDEX_ALREADY_PENDING` | 409 | knowledge |
| `EMPTY_DOCUMENT` | 400 | knowledge |
| `REFERENCED_ENTITY_NOT_FOUND` | 400 | qualquer — tradução genérica de P2003 (violação de FK) do Prisma, feita na `PrismaService` (achado do usuário, 2026-09-24: `POST /catalog/professionals` com `clinicId` inexistente vazava 500 cru) |
| `DUPLICATE_ENTRY` | 409 | qualquer — tradução genérica de P2002 (unique constraint) |
| `RECORD_NOT_FOUND` | 404 | qualquer — tradução genérica de P2025 (update/delete em registro inexistente) |
| `EXCLUSION_VIOLATION` | 409 | qualquer — tradução genérica de 23P01 (violação de constraint EXCLUDE do Postgres — `PrismaClientUnknownRequestError`, tipo diferente de P2002/P2003/P2025; achado do usuário, 2026-09-24: só o call site de `appointment_no_overlap` tratava isso, qualquer outra constraint EXCLUDE bateria direto no `AllExceptionsFilter`) |
| `INTERNAL_ERROR` | 500 | qualquer — rede de seguranca do `AllExceptionsFilter` (critério de aceite #21), nunca vaza detalhe interno |

### O que o painel faz no MVP

Ver agenda do dia/semana, criar e cancelar consulta manualmente, ver a caixa de entrada de conversas (todas, filtrável por status) e assumir uma escalada ou uma que ainda está com o bot (muda para HUMAN, o bot cala), responder pelo painel, CRUD da base de conhecimento com reingestão, CRUD de profissionais/procedimentos/disponibilidade.

### Custo dessa separação (aceito conscientemente)

CORS para configurar, autenticação para implementar de verdade, dois projetos para rodar. Vale a pena porque o dado é sensível e porque a API já existe para o agente — o painel é só mais um cliente dela.

## 6. Estrutura de pastas

Tudo abaixo é a raiz de `clinica-api`. Não existe pasta de front aqui.

Monolito modular: um único processo e um único deploy, mas o código é organizado por módulo de negócio primeiro, camada dentro. Não existe pasta `domain/` global — cada módulo tem a sua.

```
src/
  modules/
    catalog/                     # clínica, profissionais, procedimentos, convênios, disponibilidade
      domain/
        entities/                # Professional, Procedure, AvailabilityRule
        services/                # SlotGenerator
        errors/
      application/
        list-available-slots.use-case.ts
        manage-catalog.use-case.ts
      infrastructure/
        prisma-catalog.repository.ts
      interface/
        catalog.admin-controller.ts
      catalog.module.ts
      index.ts                   # API PÚBLICA do módulo — só o que sai daqui é importável

    scheduling/                  # consultas, hold, saga, concorrência
      domain/
        entities/                # Appointment
        services/                # SchedulingPolicy
        errors/                  # SlotTakenError, HoldExpiredError
      application/
        hold-slot.use-case.ts
        confirm-appointment.use-case.ts
        cancel-appointment.use-case.ts
        reschedule-appointment.use-case.ts
        expire-holds.job.ts
      infrastructure/
        prisma-appointment.repository.ts
      interface/
        appointments.admin-controller.ts
      scheduling.module.ts
      index.ts

    conversation/                # conversa, mensagens, máquina de estados, handoff
      domain/
        entities/                # Conversation, Message
        state-machine/           # SchedulingStateMachine
      application/
        handle-inbound-message.use-case.ts
        takeover.use-case.ts
        escalate-to-human.use-case.ts
      infrastructure/
      interface/
        conversations.admin-controller.ts
      conversation.module.ts
      index.ts

    agent/                       # orquestrador de IA — o "cérebro"
      application/
        orchestrator.ts
        tools/                   # uma tool por arquivo, cada uma chamando um módulo
        guardrails/
        prompts/
      infrastructure/
        gemini-llm.adapter.ts
      ports/
        llm.port.ts
      agent.module.ts
      index.ts

    knowledge/                   # RAG
      domain/
      application/
        search-knowledge.use-case.ts
        ingest-document.use-case.ts
      infrastructure/
        pgvector-retriever.repository.ts
        embedder/                # gemini | local
      interface/
        knowledge.admin-controller.ts
      knowledge.module.ts
      index.ts

    messaging/                   # canal WhatsApp: inbox, outbox, envio
      application/
        process-inbound.job.ts
        dispatch-outbox.job.ts
      infrastructure/
        whatsapp-cloud.adapter.ts
      interface/
        whatsapp.webhook-controller.ts   # SUPERFÍCIE PÚBLICA — só HMAC
      ports/
        messaging.port.ts
      messaging.module.ts
      index.ts

    identity/                    # usuários do painel, sessão, RBAC, auditoria
      domain/
      application/
        login.use-case.ts
        audit.service.ts
      infrastructure/
      interface/
        auth.admin-controller.ts
        guards/                  # SessionGuard, RolesGuard, AuditInterceptor
      identity.module.ts
      index.ts

  shared/                        # infraestrutura transversal, SEM regra de negócio
    kernel/                      # Result, DomainError base, tipos de id, Clock
    database/                    # PrismaService
    queue/                       # BullMQ setup
    config/                      # validação de env com Zod
    http/                        # filtro de exceção, formato de erro padrão

  app.module.ts
  main.ts

prisma/
  schema.prisma
  migrations/
  seed.ts
test/
.env                             # DATABASE_URL, chaves da Meta e do LLM
```

### Regras do monolito modular

- **MM-01** — Um módulo só importa outro pelo `index.ts` dele. `import { HoldSlotUseCase } from '../scheduling'` é válido; `import ... from '../scheduling/domain/entities/appointment'` não é.
- **MM-02** — O `index.ts` exporta apenas casos de uso, DTOs e erros públicos. Entidade de domínio, repositório e Prisma model nunca cruzam a fronteira do módulo.
- **MM-03** — Cada módulo é dono das suas tabelas. `scheduling` escreve em `Appointment`; ninguém mais escreve. Precisa do dado de outro módulo? Chama o caso de uso dele — não faz join por cima da fronteira.
- **MM-04** — Dentro do módulo vale a regra de camada: `interface` → `application` → `domain`. `infrastructure` implementa portas declaradas em `application`. `domain` não importa NestJS, Prisma nem nada de fora.
- **MM-05** — Dependência circular entre módulos é proibida. Se dois precisam um do outro, a comunicação de volta é por evento de domínio, não por import.
- **MM-06** — O módulo `agent` é o único que fala com o LLM. Ele orquestra os outros chamando os casos de uso públicos deles; nunca replica regra de negócio que já existe em `scheduling` ou `catalog`.
- **MM-07** — `shared/` é infraestrutura transversal. Se você sentir vontade de colocar regra de negócio lá, ela pertence a algum módulo.

### Grafo de dependências permitido

```
messaging, metrics  →  conversation  →  agent  →  scheduling  →  catalog
                                             ↘  knowledge
identity            →  (nenhum)                       shared ← todos (nunca importa de modules/)
```

Toda seta não desenhada acima também vale para `identity`: qualquer módulo pode importar `identity` (guards/RBAC), e `identity` não importa nenhum outro módulo. `metrics` só compõe (`conversation` + `scheduling`), não escreve tabela própria.

Setas apontam para quem é chamado. Nenhuma seta volta — e "ainda não formou ciclo" não é suficiente: uma aresta na direção errada (ex.: `catalog` importando `scheduling`) é violação mesmo sem ciclo, porque quebra a ordem de camadas da seção 3 (agendamento depende do catálogo, nunca o contrário). Lista exata de arestas permitidas, por módulo de origem — o que não está aqui é proibido, precisa de decisão consciente pra virar aresta nova, não só evitar formar ciclo:

| De | Para (além de `identity`, sempre permitido) |
|---|---|
| `catalog` | — |
| `scheduling` | `catalog` |
| `conversation` | `agent`, `catalog` |
| `agent` | `catalog`, `knowledge`, `scheduling` |
| `knowledge` | — |
| `messaging` | `conversation`, `scheduling` |
| `metrics` | `conversation`, `scheduling` |
| `identity` | — |

Verificado automaticamente por `dependency-cruiser` (`.dependency-cruiser.cjs`, `npm run depcruise`) desde 2026-09-23 — ver seção 16, critérios #18/#19.

Por que monolito modular e não microserviços: um processo, um deploy, uma transação de banco — o que importa aqui é o agendamento ser consistente, e isso é trivial num monolito e doloroso distribuído. Os módulos com fronteira explícita mantêm a opção de extrair um deles depois, se algum dia fizer sentido.

## 7. Modelo de dados (Prisma)

> Este bloco é uma cópia do `prisma/schema.prisma` real do projeto, atualizada na Fase 2. **Se este texto e o arquivo divergirem, o arquivo manda** — mas divergência é bug de documentação a ser corrigido, não motivo para "corrigir" o arquivo de volta ao texto.

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [vector]
}

// ---------- Catalogo ----------

// Pendente pra Fase 6 Etapa 4 (RN-25, interruptor global de IA) — ainda
// NAO existe no schema.prisma real, so registrado aqui como decisao ja
// tomada: Clinic precisa ganhar `aiEnabled Boolean @default(true)`
// (migration propria, separada do codigo, quando a Etapa 4 implementar
// o endpoint `/api/admin/settings/ai-enabled`).
model Clinic {
  id            String         @id @default(uuid())
  name          String
  timezone      String         @default("America/Fortaleza")
  addressLine   String
  phone         String
  professionals Professional[]
  procedures    Procedure[]
  createdAt     DateTime       @default(now())
}

model Professional {
  id            String   @id @default(uuid())
  clinicId      String
  clinic        Clinic   @relation(fields: [clinicId], references: [id])
  name          String
  specialty     String
  councilNumber String? // CRM
  active        Boolean  @default(true)

  availabilityRules      AvailabilityRule[]
  availabilityExceptions AvailabilityException[]
  appointments           Appointment[]
  procedures             ProcedureOnProfessional[]
}

model Procedure {
  id             String   @id @default(uuid())
  clinicId       String
  clinic         Clinic   @relation(fields: [clinicId], references: [id])
  name           String
  durationMin    Int
  priceCents     Int?
  requiresReturn Boolean  @default(false)
  active         Boolean  @default(true)

  professionals ProcedureOnProfessional[]
  appointments  Appointment[]
}

model ProcedureOnProfessional {
  procedureId    String
  professionalId String
  procedure      Procedure    @relation(fields: [procedureId], references: [id])
  professional   Professional @relation(fields: [professionalId], references: [id])

  @@id([procedureId, professionalId])
}

model InsurancePlan {
  id       String    @id @default(uuid())
  name     String    @unique
  accepted Boolean   @default(true)
  notes    String?
  patients Patient[]
}

// ---------- Disponibilidade ----------

model AvailabilityRule {
  id             String       @id @default(uuid())
  professionalId String
  professional   Professional @relation(fields: [professionalId], references: [id])
  weekday        Int // 0 = domingo ... 6 = sabado
  startTime      String // "08:00" — horario local da clinica
  endTime        String // "12:00"
  slotMinutes    Int          @default(30)

  @@index([professionalId, weekday])
}

model AvailabilityException {
  id             String       @id @default(uuid())
  professionalId String
  professional   Professional @relation(fields: [professionalId], references: [id])
  startsAt       DateTime // UTC
  endsAt         DateTime // UTC
  reason         String?
  blocking       Boolean      @default(true) // false = disponibilidade extra

  @@index([professionalId, startsAt])
}

// ---------- Pacientes e consultas ----------

model Patient {
  id            String         @id @default(uuid())
  phoneE164     String         @unique
  name          String?
  birthDate     DateTime?
  insuranceId   String?
  insurance     InsurancePlan? @relation(fields: [insuranceId], references: [id])
  appointments  Appointment[]
  conversations Conversation[]
  createdAt     DateTime       @default(now())
}

enum AppointmentStatus {
  HELD
  CONFIRMED
  CANCELLED
  COMPLETED
  NO_SHOW
  EXPIRED
}

model Appointment {
  id             String            @id @default(uuid())
  professionalId String
  professional   Professional      @relation(fields: [professionalId], references: [id])
  patientId      String
  patient        Patient           @relation(fields: [patientId], references: [id])
  procedureId    String
  procedure      Procedure         @relation(fields: [procedureId], references: [id])

  startsAt         DateTime          // UTC
  endsAt           DateTime          // UTC
  status           AppointmentStatus @default(HELD)
  holdExpiresAt    DateTime?
  cancelReason     String?
  lateCancellation Boolean           @default(false) // RN-12: cancelado com menos de LATE_CANCEL_HOURS de antecedencia — adicionado na Fase 2, ausente na versao original desta spec
  createdBy        String            @default("agent") // agent | human | patient

  version   Int      @default(0) // lock otimista
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([professionalId, startsAt])
  @@index([patientId, status])
  @@index([status, holdExpiresAt])
}

// ---------- Conversa ----------

enum ConversationStatus {
  BOT
  AWAITING_HUMAN
  HUMAN
  CLOSED
}

enum SchedulingStep {
  IDLE
  COLLECTING_DATA
  SLOTS_OFFERED
  SLOT_HELD
  CONFIRMED
}

model Conversation {
  id              String              @id @default(uuid())
  patientId       String
  patient         Patient             @relation(fields: [patientId], references: [id])
  status          ConversationStatus  @default(BOT)
  schedulingStep  SchedulingStep      @default(IDLE)
  context         Json                @default("{}") // dados coletados parciais
  lastInboundAt   DateTime?
  windowExpiresAt DateTime? // janela de 24h do WhatsApp
  consecutiveLlmErrors Int            @default(0) // RN-16: turnos consecutivos em llm_error, ver seção 12
  assignedUserId  String?             // quem do painel assumiu (RN-26 estendida, seção 12)
  assignedUser    User?               @relation(fields: [assignedUserId], references: [id])
  // RN-22 le ISSO pra decidir expurgo, nunca updatedAt (achado 2026-09-24:
  // updatedAt é infraestrutura do ORM, sobe em qualquer toque na linha —
  // usar isso pra retenção deixaria uma ação administrativa estender
  // silenciosamente o prazo de guarda de dado sensível). Estampado pelo
  // Clock na criação da conversa e em toda Message nova, de qualquer role.
  lastActivityAt  DateTime            @default(now())
  messages        Message[]
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt // infraestrutura/exibição — nunca lido por regra de negócio

  @@index([patientId, status])
}

enum MessageRole {
  PATIENT
  AGENT
  HUMAN
  SYSTEM
}

model Message {
  id             String       @id @default(uuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id])
  role           MessageRole
  content        String
  toolCalls      Json?
  externalId     String?      @unique // wamid
  createdAt      DateTime     @default(now())

  @@index([conversationId, createdAt])
}

model HandoffTicket {
  id             String    @id @default(uuid())
  conversationId String
  reason         String
  summary        String
  resolvedAt     DateTime?
  createdAt      DateTime  @default(now())
}

// ---------- Infra de mensageria ----------

model InboundEvent {
  id          String    @id @default(uuid())
  externalId  String    @unique // wamid — chave de idempotencia
  payload     Json
  processedAt DateTime?
  createdAt   DateTime  @default(now())
}

enum OutboxStatus {
  PENDING
  SENT     // Cloud API aceitou — só isso, nunca "dispatch pulado" (achado do usuário, 2026-09-24)
  FAILED
  SKIPPED  // OUTBOX_DISPATCH_ENABLED=false — dispatch pulado por configuração, nunca enviado de verdade
}

model OutboxMessage {
  id           String       @id @default(uuid())
  toPhoneE164  String
  body         String
  templateName String?
  templateArgs Json?
  status       OutboxStatus @default(PENDING)
  attempts     Int          @default(0)
  lastError    String?
  sentAt       DateTime?
  createdAt    DateTime     @default(now())

  @@index([status, createdAt])
}

// ---------- Painel administrativo ----------

enum UserRole {
  ADMIN
  RECEPCAO
  PROFISSIONAL
}

model User {
  id             String    @id @default(uuid())
  email          String    @unique
  passwordHash   String // argon2id
  name           String
  role           UserRole
  professionalId String? // obrigatorio quando role = PROFISSIONAL
  active         Boolean   @default(true)
  lastLoginAt    DateTime?
  sessions       Session[]
  createdAt      DateTime  @default(now())
}

model Session {
  id         String    @id @default(uuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique // hash do valor do cookie, nunca o valor cru
  expiresAt  DateTime
  ip         String?
  userAgent  String?
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())

  @@index([userId, expiresAt])
}

model AuditLog {
  id         String   @id @default(uuid())
  actorType  String // user | agent | system
  actorId    String?
  action     String // appointment.confirm | patient.read | knowledge.update | ...
  entityType String
  entityId   String
  before     Json?
  after      Json?
  ip         String?
  createdAt  DateTime @default(now())

  @@index([entityType, entityId, createdAt])
  @@index([actorId, createdAt])
}

// ---------- Conhecimento (RAG) ----------

enum KnowledgeDocumentStatus {
  PENDING // rascunho criado, job de chunking+embedding ainda nao rodou
  RUNNING // job processando
  READY // versao completa e servindo buscas (junto com active:true)
  FAILED // job esgotou tentativas — versao anterior (active:true) nunca deixou de servir
}

model KnowledgeDocument {
  id           String                  @id @default(uuid())
  title        String
  category     String // preparo_exame | convenio | localizacao | procedimento | geral
  sourceRef    String?
  content      String
  version      Int                     @default(1)
  active       Boolean                 @default(true) // so vira true apos troca atomica (ver secao 11)
  status       KnowledgeDocumentStatus @default(READY)
  errorMessage String?
  chunks       KnowledgeChunk[]
  createdAt    DateTime                @default(now())
  updatedAt    DateTime                @updatedAt
}

model KnowledgeChunk {
  id         String                       @id @default(uuid())
  documentId String
  document   KnowledgeDocument            @relation(fields: [documentId], references: [id], onDelete: Cascade)
  ordinal    Int
  content    String
  tokenCount Int
  embedding  Unsupported("vector(768)")?

  @@index([documentId])
}
```

Migrations SQL manuais adicionais (índice parcial, extensão, coluna gerada, índice HNSW) documentadas em `prisma/migrations/*/migration.sql`, com comentário explicando por que cada uma não pode ser gerada automaticamente pelo Prisma.

A constraint de exclusão GIST (`appointment_no_overlap`, migration manual `20260917170000_appointment_no_overlap`) é a última linha de defesa contra double-booking — cobre qualquer sobreposição de intervalo (`startsAt`/`endsAt`) do mesmo profissional, não só o mesmo horário exato. Substitui o índice único parcial original (`appointment_active_slot_unique`, dropado na mesma migration): esse só impedia dois agendamentos com o MESMO `startsAt`, mas `Procedure.durationMin` é variável — uma consulta de 60min às 14:00 e uma de 30min às 14:30 têm `startsAt` diferentes e passavam as duas pelo índice antigo, mesmo se sobrepondo de verdade (14:00–15:00 vs 14:30–15:00). O lock otimista via `version` é a primeira linha de defesa.

## 8. Pipeline de mensagem

```
Webhook Meta
  │
  ├─ valida assinatura X-Hub-Signature-256
  ├─ grava InboundEvent (unique wamid) ── já existe? → 200 e descarta
  └─ responde 200 imediatamente
        │
        └─ enfileira job BullMQ
              │
              ├─ DEBOUNCE: aguarda 3s; se chegar outra msg do mesmo
              │            paciente, cancela este job e reagenda
              ├─ carrega/cria Patient + Conversation
              ├─ conversation.status == HUMAN? → só persiste, não responde
              ├─ guardrail de ENTRADA (urgência / fora de escopo)
              ├─ ORQUESTRADOR (loop de tool calling, máx. 5 iterações)
              ├─ guardrail de SAÍDA (orientação médica / preço inventado)
              ├─ grava OutboxMessage
              └─ worker do outbox envia via Cloud API (retry exponencial)
```

## 9. Orquestrador

Loop simples, sem framework:

```ts
async function run(conversation: Conversation, userMessage: string): Promise<string> {
  const messages = buildContext(conversation, userMessage); // system + histórico (últimos 20 turnos)

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await llm.complete({ messages, tools: TOOL_SCHEMAS });

    if (!res.toolCalls?.length) return res.text;

    for (const call of res.toolCalls) {
      const result = await executeTool(call, conversation); // sempre try/catch
      messages.push(toolResultMessage(call, result));
    }
  }

  // não convergiu → escala
  return await escalate(conversation, 'max_iterations');
}
```

Regras do loop:

- `MAX_ITERATIONS = 5`. Estourou, escala para humano.
- Erro de tool nunca sobe como exceção para o LLM: vira `{ ok: false, error: "mensagem_amigavel" }`.
- Toda tool recebe `conversationId` e `patientId` do contexto — nunca do que o LLM enviou.
- O histórico enviado ao LLM é truncado nos últimos 20 turnos + resumo.

### Contrato das tools

| Tool | Entrada | Saída | Observação |
|---|---|---|---|
| `listar_procedimentos` | — | `[{id, nome, duracaoMin, precoReais?}]` | Só ativos. |
| `listar_profissionais` | `procedimentoId?` | `[{id, nome, especialidade}]` | |
| `listar_horarios` | `profissionalId, procedimentoId, dataInicio, dataFim` | `[{startsAt, label}]` | Máx. 8 slots por retorno, já em horário local. |
| `reservar_horario` | `profissionalId, procedimentoId, startsAt` | `{holdId, expiraEm}` | Cria Appointment com status HELD. |
| `confirmar_agendamento` | `holdId` | `{appointmentId, resumo}` | HELD → CONFIRMED. Falha se expirado. |
| `cancelar_agendamento` | `appointmentId, motivo?` | `{ok}` | Só consultas do próprio paciente. |
| `remarcar_agendamento` | `appointmentId, novoStartsAt` | `{appointmentId}` | Saga: reserva novo → confirma → cancela antigo. |
| `consultar_minhas_consultas` | — | `[{id, profissional, quando, status}]` | Só futuras e confirmadas. |
| `consultar_convenios` | `nome?` | `[{nome, aceito, observacao}]` | Do banco, nunca do RAG. |
| `buscar_conhecimento` | `pergunta, topK=5` | `[{conteudo, fonte, score}]` | Retorna vazio se score < limiar. |
| `escalar_humano` | `motivo, resumo` | `{ok}` | Muda conversa para AWAITING_HUMAN. |

## 10. Máquina de estados do agendamento

```
IDLE
 └─(paciente demonstra intenção de agendar)→ COLLECTING_DATA
      │ coleta: nome, procedimento, profissional (opcional), preferência de data
      └─(dados mínimos completos)→ SLOTS_OFFERED
           │ agente ofereceu N horários concretos
           ├─(paciente escolhe um)→ SLOT_HELD  [tool: reservar_horario]
           │     │ TTL de 10 min
           │     ├─(paciente confirma explicitamente)→ CONFIRMED [tool: confirmar_agendamento]
           │     ├─(paciente pede outro)→ SLOTS_OFFERED (libera o hold)
           │     └─(TTL expira)→ IDLE (job libera o hold, avisa o paciente)
           └─(nenhum serve)→ COLLECTING_DATA
```

Transições só acontecem via serviço de domínio. O LLM informa a intenção; o `SchedulingStateMachine` valida se a transição é legal a partir do estado atual e rejeita as ilegais.

### Saga de reserva

```
1. hold        → INSERT Appointment (HELD, holdExpiresAt = now + 10min)
                 → se violar índice único: slot tomado, retorna erro amigável
2. confirm     → UPDATE "Appointment"
                    SET status = 'CONFIRMED', version = version + 1,
                        "holdExpiresAt" = NULL
                  WHERE id = $1 AND version = $2
                    AND status = 'HELD' AND "holdExpiresAt" > now()
                 → 0 linhas afetadas = expirou ou concorrência → recomeça oferta
3. compensação → job a cada 1 min: HELD com holdExpiresAt < now() → EXPIRED
```

## 11. RAG

### Ingestão (offline, comando CLI)

```
documento (md/txt) → chunking semântico (400–600 tokens, overlap 15%)
                   → embedding
                   → INSERT KnowledgeChunk
```

Metadados obrigatórios em cada documento: `category`, `version`, `active`. Reingestão cria nova versão e desativa a anterior — nunca apaga.

> **Reindexação pelo painel admin (Fase 6, seção 5):** chunking+embedding é uma chamada de rede por chunk — um documento de dezenas de chunks pode passar de um minuto, e uma falha do provedor no meio não pode deixar a operação pela metade. Por isso `POST/PUT /api/admin/knowledge` e `POST /api/admin/knowledge/:id/reindex` nunca processam isso dentro da requisição: criam a linha da nova versão com `status:'PENDING'` e `active:false`, respondem 202, e um job na fila (mesmo padrão de `attempts`+backoff exponencial do envio de mensagem) faz o chunking+embedding de verdade. **A troca é atômica**: a versão anterior continua `active:true` e servindo buscas normalmente durante todo o processamento; só numa única transação, depois que TODOS os chunks da nova versão foram inseridos com sucesso, é que ela vira `active:true` (`status:'READY'`) e a anterior vira `active:false`. Se o job falhar mesmo depois de esgotar as tentativas, a versão nova fica `status:'FAILED'` (com o erro registrado) e a anterior nunca deixou de servir. Nunca existe uma janela em que um documento existente fica ausente da base por causa de uma reindexação em andamento.

### Consulta (online)

```
pergunta
  → embedding da pergunta
  → busca híbrida:
       A) vetorial: ORDER BY embedding <=> $1 LIMIT 20
       B) textual:  ts_rank(content_tsv, plainto_tsquery('portuguese', $1)) LIMIT 20
  → fusão RRF (Reciprocal Rank Fusion, k=60)
  → top 5
  → se melhor score < RAG_SCORE_THRESHOLD → retorna vazio
```

> **Nota de implementação (Fase 4):** "melhor score" acima é a **similaridade de cosseno real** (0 a 1) do resultado mais bem ranqueado — não o score bruto da fusão RRF. Com k=60, o score RRF máximo possível é 2/61 ≈ 0,033, numa escala incompatível com um limiar tipo 0,65. RRF decide só a ORDEM (por isso não precisa normalizar vetorial×textual); o corte de confiança usa a métrica vetorial original. Ver `rrf-fusion.ts`/`SearchKnowledgeUseCase`.

Vazio significa vazio. O agente responde que não tem essa informação e oferece falar com a recepção. Nunca preenche a lacuna com conhecimento do modelo.

> **Calibração de `RAG_SCORE_THRESHOLD` (Fase 4, verificado em 2026-09-17):** 0,35 era chute puro (nunca testado). Calibrado na mão contra o Gemini real (`gemini-embedding-001`) com 4 documentos de exemplo (localização, preparo de exame, política de atraso, o que esperar da consulta) e 3 perguntas:
> - Dentro da base ("como chego de ônibus na clínica?"): **0,72**.
> - Plausível mas não coberta ("vocês têm estacionamento gratuito?" — pergunta real de paciente, sem documento correspondente): **0,63**.
> - Sem relação nenhuma ("qual é a capital da França?"): **0,47**.
>
> Achado: com 0,35, **todas as três** passariam o limiar — inclusive a pergunta sem relação nenhuma com a clínica. `gemini-embedding-001` produz similaridade de cosseno com piso alto entre textos curtos em português do mesmo domínio geral (saúde/clínica), mesmo sem relação temática real. Limiar ajustado para **0,65**, que separa a pergunta coberta (0,72) das outras duas (0,63 e 0,47) nesta amostra.
>
> Ressalva explícita: amostra pequena (4 documentos, 3 perguntas, testado uma vez). A margem entre "coberta" (0,72) e "plausível mas não coberta" (0,63) é estreita — revisitar este número assim que a base de conhecimento real for populada e houver perguntas reais de pacientes para testar contra ela. Não tratar 0,65 como definitivo. **Recalibração fica ao alcance do próprio dono da clínica (Fase 6, seção 5):** `POST /api/admin/knowledge/test-search` roda o mesmo pipeline de busca sem aplicar o corte do limiar, devolvendo os 5 candidatos com o score real de cada um e se passariam no limiar atual — sem isso, ninguém percebe que a distribuição de score mudou até o bot começar a recusar pergunta que a base já responde.
>
> **Checagem de falso negativo (mesmo dia):** subir o limiar troca o modo de falha — de "responde qualquer coisa" para "recusa pergunta legítima". Testado com 12 paráfrases realistas das 4 perguntas que a base cobre (3 por documento, variando vocabulário e forma), contra o Gemini real: **12/12 passaram de 0,65**, com a menor pontuação em 0,717 (margem de ~0,07 acima do limiar) e a maioria entre 0,73 e 0,89. Não elimina o risco de falso negativo com conteúdo real futuro, mas não há evidência dele nesta amostra.

### O que NÃO entra no RAG

Preço, convênio aceito, horário disponível, nome de profissional, duração de procedimento, endereço. Tudo isso é tool lendo o banco. RAG é só para texto estável e explicativo (preparo de exame, o que esperar da consulta, como chegar de ônibus, política de atraso).

## 12. Regras de negócio

### Segurança clínica (prioridade máxima)

- **RN-01** — O agente nunca dá diagnóstico, interpreta sintoma, sugere medicamento, dosagem ou tratamento. Detectou esse tipo de pedido → resposta padrão + `escalar_humano`.
- **RN-02** — Sinais de urgência (dor intensa/súbita, sangramento, febre alta, falta de ar, trauma, perda de consciência, suspeita de fratura) → resposta imediata orientando procurar pronto-socorro ou 192, + escalada. Não tenta agendar.
- **RN-03** — O agente nunca cita nome de profissional, procedimento ou convênio que não venha de tool. Alucinação nesse campo é falha crítica.

### Agendamento

- **RN-04** — Só oferece slots com no mínimo `MIN_LEAD_TIME_HOURS` (padrão 2h) de antecedência.
- **RN-05** — Só oferece slots dentro dos próximos `MAX_LOOKAHEAD_DAYS` (padrão 60).
- **RN-06** — Slot só é ofertado se: existe `AvailabilityRule` cobrindo, não há `AvailabilityException` bloqueante, e não há `Appointment` ativo (HELD/CONFIRMED) nele.
- **RN-07** — Um paciente tem no máximo 1 hold ativo por vez. Novo hold libera o anterior.
- **RN-08** — Hold expira em `HOLD_TTL_MINUTES` (padrão 10). Expirou, o paciente é avisado e volta a IDLE.
- **RN-09** — Confirmação exige afirmação explícita do paciente ("sim", "confirmo", "pode marcar"). Silêncio, emoji ambíguo ou mudança de assunto não confirmam.
- **RN-10** — Dados mínimos para reservar: nome completo, procedimento e telefone (já vem do WhatsApp). Sem os três, não sai de COLLECTING_DATA.
- **RN-11** — Paciente com consulta futura CONFIRMED do mesmo procedimento: o agente informa e pergunta se quer remarcar, em vez de criar uma segunda.
- **RN-12** — Cancelamento com menos de `LATE_CANCEL_HOURS` (padrão 24) de antecedência é gravado com flag de cancelamento tardio.
- **RN-13** — Remarcação é saga: reserva o novo, confirma, depois cancela o antigo. Falhou no meio, o antigo permanece intacto.
- **RN-14** — Paciente só lê, cancela ou remarca consulta vinculada ao próprio `patientId`. Verificação no serviço, não no prompt.

### Conversa

- **RN-15** — `conversation.status == HUMAN` → o bot só persiste mensagens, não responde. Retomada é manual.
- **RN-16** — 3 turnos consecutivos sem progresso de estado, ou 2 erros de tool seguidos → escalada automática. Cobre também a falha de infraestrutura do LLM (`llm_error`): uma falha isolada não escala (mensagem fica pendente, tenta de novo depois via `ReprocessStuckTurnsJob`), mas `LLM_ERROR_ESCALATION_THRESHOLD` (padrão 3) turnos consecutivos terminados em `llm_error` escalam pra humano em vez de reprocessar pra sempre — achado do incidente de 2026-09-23 (ver CLAUDE.md): sem teto, uma instabilidade sustentada do provedor reenfileirava a mesma conversa a cada tick indefinidamente, sem nunca escalar.
  > **Achado no teste manual da Fase 3 (retry/fallback do Gemini, ver `gemini-llm.adapter.ts`), item (1) resolvido na Fase 5, item (2) deliberadamente adiado:** quando `HandleDebouncedMessageUseCase` recebe `reason: 'llm_error'` (falha transitória de infraestrutura, já depois de esgotar retry+fallback de modelo), a mensagem do paciente fica corretamente não consumida e a conversa não escala — mas nada reagendava o turno sozinho. (1) **Resolvido**: `ReprocessStuckTurnsJob` (`src/modules/messaging/application/reprocess-stuck-turns.job.ts`, mesmo padrão do `ExpireHoldsJob`) roda a cada `REPROCESS_CHECK_INTERVAL_MS` (10min), acha conversas `BOT` com mensagem de paciente não consumida há mais de `STUCK_MESSAGE_REPROCESS_MINUTES` (padrão 15) e reenfileira o turno com o mesmo `jobId` determinístico do debounce normal. (2) **Não implementado, fora do escopo pedido na Fase 5**: não há contador de tentativas nem escalada automática após N falhas seguidas do mesmo turno — numa instabilidade sustentada do provedor, este job reenfileiraria a mesma conversa indefinidamente a cada tick. Limitação documentada no próprio código do job.
- **RN-17** — Mensagem de áudio, imagem, vídeo ou documento → resposta padrão informando que só texto é atendido + escalada.
- **RN-18** — Fora da janela de 24h do WhatsApp, só é possível enviar template aprovado. O outbox verifica `windowExpiresAt` antes de enviar texto livre.
- **RN-19** — Toda data apresentada ao paciente em português por extenso e no fuso da clínica: "quinta-feira, 18 de setembro, às 14h30".
- **RN-20** — O agente se identifica como assistente virtual na primeira mensagem de cada conversa nova.
- **RN-25** — Interruptor global de IA: uma chave única desliga o agente pra clínica inteira, independente do `status` de cada conversa individual. Controle de emergência (painel virou o canal de WhatsApp deles — precisa dar pra desligar tudo na hora, não conversa por conversa), não conveniência de UX. Enquanto desligado, toda mensagem nova cai direto em atendimento humano (mesmo comportamento de `HUMAN`), sem tentar chamar o LLM.
- **RN-26** — Assunção implícita: se alguém do painel manda mensagem numa conversa que está em `BOT` (ou `AWAITING_HUMAN`), ela vira `HUMAN` automaticamente, sem precisar clicar em "assumir" antes. Acompanha o uso real — a recepcionista vê a mensagem chegando e já responde, não passa por um passo de confirmação primeiro. Sem isso, bot e humano respondem por cima um do outro na mesma conversa (duas vozes). **Estendida (achado do front, contrato da Fase 1, 2026-09-24):** `Conversation.assignedUserId` registra quem está cuidando da conversa agora — setado no takeover explícito (`POST .../takeover`, aceita `BOT` **ou** `AWAITING_HUMAN`, não só `AWAITING_HUMAN`) e também na assunção implícita (mandar mensagem). Se a conversa já está `HUMAN` com outra pessoa assumida e um SEGUNDO usuário do painel manda mensagem, `assignedUserId` passa pro segundo — cobre o cenário de **duas recepcionistas**: sem isso, a tela não tem como mostrar que alguém já está atendendo, e a segunda pessoa não sabe se está pisando no atendimento da primeira. `Message.authorUserId` (para role `HUMAN`) identifica quem mandou cada mensagem especificamente. `release` (`HUMAN → BOT`) limpa `assignedUserId` — ninguém do painel está mais responsável.

### Dados e LGPD

- **RN-21** — Dado de saúde é dado sensível (LGPD art. 11). Log de aplicação com redação de nome, telefone e conteúdo clínico.
- **RN-22** — Retenção de conversas: conversas com `Conversation.lastActivityAt` além de `CONVERSATION_RETENTION_DAYS` (padrão 180) têm o **conteúdo redigido**, nunca a linha deletada. **`lastActivityAt`, não `updatedAt` (achado do usuário, 2026-09-24):** `updatedAt` é campo de infraestrutura do ORM, sobe em qualquer toque na linha (`assignedUserId` setado, job mudando status) sem relação com atividade real do paciente — usar isso pra decidir retenção deixaria uma ação administrativa estender silenciosamente o prazo de guarda de dado sensível, problema de LGPD, não só de testabilidade. `lastActivityAt` é campo de domínio, estampado pelo `Clock` na criação da conversa e em toda `Message` nova (de qualquer role — paciente, agente ou humano), nunca por um toque puramente administrativo. A intenção da redação sempre foi essa — deletar destruiria o rastro de que a conversa existiu, exatamente o que SEC-10 e RN-24 exigem preservar; redigir elimina o dado sensível (o que a LGPD pede) mantendo o esqueleto auditável (o que a auditoria pede). `Message.content` e `HandoffTicket.summary` são sobrescritos por um marcador fixo; `Conversation.context` é limpo (`{}`) e `status` vira `CLOSED`. **O que deliberadamente NÃO é redigido** (quem ler esta regra daqui a um ano precisa saber que sobra vínculo paciente↔conversa, e que isso é intencional): `Conversation` mantém `patientId`, `createdAt`/`updatedAt`/`lastActivityAt` e o histórico de `status`; `Message` mantém `role`, `createdAt` e `externalId` (wamid) — só o texto muda. `Appointment` e `Patient` nunca são tocados, direta ou indiretamente (guarda clínica é regra à parte, seção 12 nota da Fase 5). Executado por `PurgeConversationsJob`, condicionado a `RETENTION_PURGE_ENABLED=true` (padrão `false` em todo ambiente — produção liga explicitamente; ver seção 14 e o achado do incidente de 2026-09-23 documentado no `CLAUDE.md`).
- **RN-23** — O conteúdo enviado ao provedor de LLM não inclui CPF, data de nascimento completa nem histórico clínico.
- **RN-24** — Toda transição de `Appointment` gera registro de auditoria (quem, quando, de qual estado para qual).

## 13. Guardrails

**Entrada** (antes do LLM): classificador barato ou regex + modelo pequeno para detectar urgência (RN-02) e pedido de orientação médica (RN-01). Positivo → curto-circuito, não chama o orquestrador.

**Saída** (depois do LLM, antes do outbox): rejeita resposta que contenha valor em reais, nome de profissional ou nome de convênio que não tenha aparecido em resultado de tool naquele turno. Rejeitou → regenera uma vez; falhou de novo → escala.

## 14. Variáveis de ambiente

Ver `.env.example` na raiz do projeto — mantido em sincronia com esta lista.

```bash
# Banco / infra
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/clinica
REDIS_URL=redis://localhost:6379

# WhatsApp Cloud API
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=            # validação da assinatura do webhook
WHATSAPP_REMINDER_TEMPLATE_NAME=lembrete_consulta_24h  # precisa existir e estar aprovado no WhatsApp Manager

# LLM
LLM_PROVIDER=gemini
GEMINI_API_KEY=
LLM_MODEL=gemini-3.5-flash,gemini-3-flash-preview  # lista ordenada, fallback em 429/5xx/404 — confirmado 2026-09-24 contra o .env real, ver nota abaixo
LLM_MAX_ITERATIONS=5

# Embeddings
EMBEDDING_PROVIDER=gemini       # gemini | local
EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_DIMENSIONS=768

# Regras de negócio
CLINIC_TIMEZONE=America/Fortaleza
MIN_LEAD_TIME_HOURS=2
MAX_LOOKAHEAD_DAYS=60
HOLD_TTL_MINUTES=10
LATE_CANCEL_HOURS=24
MESSAGE_DEBOUNCE_MS=3000
STUCK_MESSAGE_REPROCESS_MINUTES=15  # RN-16: mensagem presa por llm_error reprocessa sozinha após esse tempo
LLM_ERROR_ESCALATION_THRESHOLD=3    # RN-16: turnos CONSECUTIVOS terminados em llm_error até escalar pra humano (teto do reprocessamento, achado do incidente de 2026-09-23)
RAG_SCORE_THRESHOLD=0.65       # calibrado contra o Gemini real, ver seção 11
CONVERSATION_RETENTION_DAYS=180
RETENTION_PURGE_ENABLED=false  # flag destrutiva (RN-22 redige conversa+ticket) — padrão false em TODO ambiente, produção liga explicitamente. Só aceita "true"/"false" (nunca "1"/"TRUE"/etc — falha alto em vez de aceitar sinônimo)
OUTBOX_DISPATCH_ENABLED=false  # achado do front (contrato da Fase 1): desligado, DispatchOutboxJob loga e marca SKIPPED em vez de chamar a WhatsApp Cloud API real — testa o caminho completo de envio sem risco de mandar mensagem real pra um dos poucos números de teste da Meta. SENT continua significando só "a Cloud API aceitou" (achado do usuário, 2026-09-24: marcar SENT aqui era dado falso — painel mostrava "entregue" pra mensagem nunca enviada). Mesmo padrão de RETENTION_PURGE_ENABLED (z.enum, não z.coerce.boolean()).

# Painel administrativo
ADMIN_ORIGIN=http://localhost:3001     # allowlist de CORS — nunca "*"
SESSION_COOKIE_NAME=clinica_session
SESSION_TTL_HOURS=12
SESSION_SECRET=                        # assinatura do cookie
LOGIN_RATE_LIMIT=5/15m                 # só falha conta, chave inclui e-mail (achado do incidente de 2026-09-23, ver CLAUDE.md)
AUDIT_DEDUP_WINDOW_SECONDS=60          # SEC-10: mesmo (ator, entidade, ação) dentro dessa janela não gera 2ª linha de AuditLog (achado do front — polling do painel)
```

> **Confirmação do modelo LLM (achado do usuário, 2026-09-24):** verificado que `.env`, `.env.example` e esta seção já concordam — `gemini-3.5-flash,gemini-3-flash-preview`. Não havia divergência no momento da checagem; a menção a "gemini-2.5-flash" que motivou a dúvida provavelmente veio do comentário do `.env.example` sobre modelos **recusados** (404 em contas novas), não do modelo ativo. Regra confirmada: `.env` é a fonte da verdade, esta seção descreve o que ele diz.

## 15. Ordem de implementação

Entregar uma fase por vez, com teste passando antes de começar a próxima.

- **Fase 0 — Fundação**: docker-compose.yml (postgres+pgvector, redis), projeto NestJS, Prisma inicializado, schema aplicado, seed com 1 clínica, 2 profissionais, 4 procedimentos, regras de disponibilidade. Health check respondendo. ✅ Concluída.
- **Fase 1 — Canal**: Webhook do WhatsApp: verificação (GET) e recebimento (POST) com validação de assinatura. InboundEvent com idempotência. Fila BullMQ com debounce. Outbox + worker de envio com retry. Teste de ponta a ponta: paciente manda "oi", recebe eco. ✅ Concluída.
- **Fase 2 — Agendamento sem IA**: SlotGenerator, casos de uso de listar/reservar/confirmar/cancelar/remarcar, lock otimista, job de expiração de hold. Testado só por testes automatizados, sem LLM. Inclui teste de concorrência: duas reservas simultâneas do mesmo slot, uma falha. ✅ Concluída. Correção pendente aplicada antes da Fase 4: o índice único parcial original só impedia o MESMO `startsAt` — com `Procedure.durationMin` variável, duas consultas com início diferente podiam se sobrepor de verdade. Substituído por constraint de exclusão GIST (`appointment_no_overlap`), cobrindo qualquer sobreposição de intervalo; `SlotGenerator` passou a respeitar a duração do procedimento pedido, não o grid fixo da regra.
- **Fase 3 — Orquestrador**: LlmPort + adapter Gemini, schemas das tools, loop de tool calling, máquina de estados da conversa, prompt de sistema. Agendamento funcionando por conversa natural. **Inclui os guardrails de entrada RN-01 (nunca dar orientação clínica) e RN-02 (sinais de urgência → escalada imediata)**, antecipados da Fase 5 — decisão tomada depois da Fase 2: deixar o agente conversar por duas fases inteiras sem esse filtro faria o primeiro teste com "dor forte no joelho" tentar agendar uma consulta, e isso não pode virar o comportamento padrão consolidado no prompt/testes nem em desenvolvimento. Validado na mão contra a API real do Gemini (retry+backoff+fallback de modelo — 503 "high demand" é comportamento normal do free tier, não exceção). ✅ Concluída. Gap conhecido, registrado para a Fase 5 junto com RN-16 (seção 12): falha transitória do LLM hoje não perde a mensagem nem escala à toa, mas também não reagenda o turno sozinha — falta o job varredor.
- **Fase 4 — RAG**: Extensão vector, tabelas de conhecimento, CLI de ingestão (`scripts/ingest-knowledge.ts`), busca híbrida com RRF, tool `buscar_conhecimento`, limiar de score calibrado na mão contra o Gemini real (ver nota na seção 11). `EmbeddingPort`/`GeminiEmbeddingAdapter` seguem o mesmo padrão do `LlmPort`; `FakeEmbeddingPort` com vetores controlados torna RRF/limiar testáveis sem rede. `KnowledgeModule` valida no boot que `EMBEDDING_DIMENSIONS` bate com a dimensão real da coluna. ✅ Concluída. Índice HNSW deliberadamente **não** criado nesta fase — só depois da base real ser populada (decisão fechada na Fase 6/Etapa 5, ver abaixo).
- **Fase 6, Etapa 5 — Knowledge admin**: CRUD de documentos (`/api/admin/knowledge`) assíncrono — chunking+embedding roda em job (`ReindexKnowledgeDocumentJob`), nunca na requisição HTTP, com troca atômica entre versões (ver nota na seção 11). Ferramenta de calibração `POST /api/admin/knowledge/test-search` (achado do usuário, fora do escopo original) expõe o score real de cada candidato sem cortar pelo limiar. Índice HNSW criado nesta etapa (migration `20260922015409_knowledge_chunk_hnsw_index`), fechando o item pendente desde a Fase 0/4.
- **Incidente de 2026-09-23 — repeatables represados**: subir a aplicação em dev, depois de dias sem ficar no ar continuamente, drenou de uma vez um acúmulo de ocorrências vencidas em 3 das 4 filas repetíveis do projeto (2 execuções de `conversation-purge`, 12 de `reprocess-stuck-turns`, 15 de `scheduling-maintenance`) — mecanismo real documentado no `CLAUDE.md`, não "repeatable dispara imediato ao registrar". `registerRepeatableJob` (`shared/queue/register-repeatable-job.ts`) passa a ser o único ponto de registro das 4 filas (a quarta, `appointment-reminder`, é a mais sensível — manda template de verdade pro WhatsApp), sempre limpando scheduler + ocorrência pendente antes de reagendar. RN-22 ganhou a flag `RETENTION_PURGE_ENABLED` (padrão `false`) como segunda camada de proteção — mesmo com o registro limpo, o expurgo não roda sem ligar explicitamente. Trava de CI (`scripts/check-repeatable-registration.ts`) impede que a opção `repeat` do BullMQ volte a aparecer fora desse arquivo único.
- **Fase 5 — Guardrails e operação**: Guardrail de **saída** (RN-03) — `AuthorizedFacts` acumulado como estado do turno inteiro pelo `RunOrchestratorTurnUseCase` (cresce a cada tool bem-sucedida, extração genérica por convenção de nome de campo `nome`/`preco`, não hardcoded por tool); rejeição regenera a resposta uma vez, segunda rejeição escala com `reason:'RN-03'` — caminho distinto do desvio de `llm_error`, confirmado por teste de regressão explícito. Lembrete de consulta 24h antes via `sendTemplate` novo no `MessagingPort` (`SendAppointmentReminderJob`, `Appointment.reminderSentAt` evita duplicata). Expurgo por retenção (RN-22): `PurgeConversationsJob` anonimiza `Message.content`/`Conversation.context`/`HandoffTicket.summary` de conversas além de `CONVERSATION_RETENTION_DAYS` — **`Appointment`/`Patient` nunca são tocados**, guarda clínica é regra à parte que a spec original não separava explicitamente. Redação de PII no log (RN-21): achado concreto, não hipotético — `HandleDebouncedMessageUseCase` logava `result.summary` cru na escalada, que carrega a mensagem literal do paciente quando o motivo é RN-01/RN-02; corrigido com `redactForLog` (`shared/kernel/redact-pii.ts`). RN-18 (janela de 24h): `Conversation.windowExpiresAt` já era escrito desde a Fase 1 mas nunca lido — `DispatchOutboxJob` agora recusa texto livre fora da janela (`window_expired`) sem tentar enviar; template sempre pode furar a janela. RN-01/RN-02 (entrada) já cobertos na Fase 3. RN-16: ver nota na seção 12 — job varredor resolvido, escalada após N falhas deliberadamente fora do escopo. ✅ Concluída.
  > **Validação manual real contra a WhatsApp Cloud API (token de sistema gerado no Meta Business Manager, número de teste gratuito do próprio Meta, destinatário brasileiro cadastrado):** `sendText` confirmado tecnicamente de ponta a ponta — requisição aceita (HTTP 200, `wamid` retornado) e webhook de status de entrega recebido depois, exatamente como o código espera. A entrega final, porém, falha sempre com **erro 130497 ("Business account is restricted from messaging users in this country")**. Isolado experimentalmente: com a janela de 24h comprovadamente aberta (destinatário mandou mensagem pro número de teste primeiro, afastando a hipótese de ser só RN-18/131047), o envio ainda falhou com 130497 — confirma que é bloqueio de país, não de janela. **Limitação conhecida, não é bug de código nem tem workaround pelo lado da aplicação**: o número de teste gratuito da Meta (`+1 555-181-4724`, americano) não pode mandar mensagem pra usuários no Brasil. Resolver exige registrar um número de telefone brasileiro real na Etapa 2 do WhatsApp Manager (Configuração da produção) — fora do escopo de código desta fase. `sendTemplate` segue sem validação real pela mesma causa raiz; a cobertura automatizada (`window-expired.e2e-spec.ts`, `send-appointment-reminder.e2e-spec.ts` via `FakeMessagingPort`) é a única validação disponível até um número brasileiro real ser registrado. **Pendência explícita para retomar quando isso acontecer**: refazer a validação manual de `sendText`/`sendTemplate` fim a fim antes de considerar o lembrete de 24h pronto pra produção.
- **Fase 6 — API administrativa** (módulo identity + controllers admin): User/Session/AuditLog, login com argon2id, cookie httpOnly, SessionGuard + RolesGuard, CORS com allowlist, rate limit no login, filtro de professionalId no repositório, AuditInterceptor. Testado por teste de integração antes de existir qualquer tela.

A Fase 7 (painel Next.js) pertence ao projeto `clinica-web` e tem spec própria. Não implementar tela aqui.

## 16. Critérios de aceite

Cada um vira teste automatizado:

1. Mesmo `wamid` entregue duas vezes gera uma resposta.
2. Duas reservas concorrentes que se sobrepõem no tempo — mesmo horário exato OU apenas overlap parcial com durações diferentes: exatamente uma tem sucesso, garantido pela constraint de exclusão GIST `appointment_no_overlap` (ver §7), não por índice único.
3. Hold não confirmado em 10 min volta a ficar disponível.
4. Confirmar hold expirado falha e o agente reoferece horários.
5. Paciente A não consegue cancelar consulta do paciente B.
6. Pergunta sobre sintoma retorna escalada, nunca orientação clínica.
7. Pergunta cuja resposta não está na base retorna "não tenho essa informação", nunca resposta inventada.
8. Pergunta sobre preço vem de tool, não do RAG.
9. Slot com menos de 2h de antecedência nunca é ofertado.
10. Horário exibido ao paciente bate com America/Fortaleza mesmo com o servidor em UTC.
11. Remarcação que falha na etapa de confirmação mantém a consulta original intacta.
12. Conversa em HUMAN não recebe resposta automática.
13. Requisição à API admin sem cookie de sessão válido retorna 401 — inclusive em rota que o front "não mostra".
14. Usuário PROFISSIONAL que pede a agenda de outro profissional recebe 403 ou lista vazia, nunca os dados.
15. Requisição de origem fora do `ADMIN_ORIGIN` é bloqueada pelo CORS.
16. 6ª tentativa de login em 15 minutos é bloqueada.
17. Leitura de dados de paciente pelo painel gera `AuditLog` com ator, ação e entidade.
18. Nenhum módulo importa de outro por caminho profundo — só pelo `index.ts`.
19. Não existe dependência circular entre módulos.
20. `src/` não contém nenhum arquivo `.tsx`, nem React, nem Next — este projeto é só backend.
21. Exceção não tratada em qualquer rota — inclusive uma que não é `DomainError` nem `HttpException` (bug de programação, erro cru de driver de banco) — ainda produz `{error:{code,message}}`, nunca o formato padrão do Nest (`{statusCode,message}`). Achado real (2026-09-24): uma migration pendente fez `GET /conversations/:id` (id inexistente) devolver 500 fora do envelope — o front inteiro assume esse formato pra decidir o que mostrar.
22. Violação de FK/unique/registro inexistente/constraint EXCLUDE vinda do Prisma (P2003/P2002/P2025/23P01) nunca alcança o `AllExceptionsFilter` — sempre vira erro de domínio (400/409/404) com mensagem em português, sem nome de tabela/coluna/constraint na resposta. Achado real (2026-09-24): `POST /catalog/professionals` com `clinicId` inexistente devolvia 500 genérico pra um erro que é do cliente. Tradução feita numa única extensão da `PrismaService` (`shared/database/map-prisma-error.ts`), não repetida por repositório — cobre tanto `PrismaClientKnownRequestError` (P20xx) quanto `PrismaClientUnknownRequestError` quando a mensagem indica 23P01 (achado do usuário, mesmo dia: a extensão só cobria o primeiro tipo, 23P01 é outro).

> **Critérios 18 e 19 — verificados automaticamente desde 2026-09-23** por `dependency-cruiser` (`.dependency-cruiser.cjs`, `npm run depcruise`), rodando em CI (`.github/workflows/clinica-api-ci.yml`) a cada push/PR. A mesma configuração cobre MM-01 (import só pelo `index.ts`), MM-04 (`domain/` não importa framework/infraestrutura) e MM-05 (sem ciclo) — MM-04 não estava listado nos critérios originais, mas é regra de import pura, então ganhou verificação de graça. **MM-02, MM-03 e MM-06 continuam disciplina manual/revisão** — o que um `index.ts` exporta, qual módulo escreve em qual tabela, e se `agent` duplica regra de negócio não são coisas que um grafo de import consegue enxergar; nenhuma ferramenta os verifica hoje. Validado rodando contra o código real antes de considerar pronto (não só escrita e assumida): as regras pegam violação de verdade (testado com imports temporários deliberadamente errados) e passam limpo no código atual.

## 17. Como trabalhar neste projeto (instruções para o assistente de IA)

Reproduzido também em `CLAUDE.md` na raiz do projeto — e expandido lá com armadilhas concretas descobertas durante a implementação. Em caso de dúvida sobre processo, `CLAUDE.md` é o mais atual dos dois.

- Antes de aplicar qualquer mudança, liste os arquivos que serão impactados e aguarde aprovação.
- Separe migration de código de aplicação. Mudança de schema é um passo; o código que a consome é outro passo, em commit separado.
- Trabalhe uma fase por vez (seção 15). Não antecipe código de fases futuras.
- O `domain/` não importa NestJS, Prisma, Axios nem nada de infraestrutura. Se precisar, é sinal de que a lógica está na camada errada.
- Toda regra de negócio da seção 12 deve ser rastreável a um teste. Ao implementar, cite o código da regra (RN-07) no nome do teste.
- TypeScript em strict. Nada de `any`. Erros de domínio são classes próprias, não `throw new Error("...")`.
- Nunca confie em valor vindo do LLM para identidade ou autorização — `patientId` e `conversationId` vêm sempre do contexto do servidor.
- Este projeto é só backend. O painel é outro projeto, em outra pasta, com spec própria. Nunca crie aqui pasta `web/`, `frontend/` ou `client/`, nem arquivo `.tsx`. Se a tela precisar de um dado, o passo é criar o endpoint — não trazer a tela para cá.
- Respeite as fronteiras de módulo (MM-01 a MM-07 da seção 6). Import profundo entre módulos e dependência circular não são mesclados.
- Toda rota nova em `/api/admin/*` nasce com guard de sessão e papel declarado. Rota sem guard explícito não é mesclada.
- Prompt de sistema fica em arquivo versionado (`application/agent/prompts/`), nunca inline no código.
- Ao criar migration, escreva os SQLs da seção 7 à mão — o Prisma não gera índice parcial, índice HNSW nem coluna gerada `tsvector`.

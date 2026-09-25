import { ConversationStatus, MessageRole, PrismaClient } from '@prisma/client';

// Prefixo fixo (nao gerado por uniquePhone()) — e o que torna este seed
// idempotente e seguro de rodar contra um banco de dev com dado real
// misturado: toda execucao apaga SO patient/conversation/message cujo
// telefone comeca com isso, nunca mais nada. Padrao "990000" deixa claro,
// so de olhar, que e fixture — nunca colide com numero real (BR tem DDD
// real de 2 digitos, nunca "99").
const FIXTURE_PHONE_PREFIX = '+558599000000';
const HOUR_MS = 60 * 60 * 1000;

interface ConversationFixture {
  phoneSuffix: string;
  patientName: string;
  status: ConversationStatus;
  windowExpiresAt: Date | null;
  messages: Array<{ role: MessageRole; content: string }>;
}

/**
 * Seed repetivel de conversas em estados CONHECIDOS e NOMEADOS, pro front
 * (clinica-web) testar a caixa de entrada sem precisar pedir autorizacao
 * conversa a conversa (achado do usuario, acrescimo 2 do contrato da Fase
 * 1). Idempotente: cada rodada apaga e recria so as PROPRIAS fixtures
 * (telefone com FIXTURE_PHONE_PREFIX), nunca toca em conversa real nem em
 * fixture de outro script/teste.
 */
export async function seedTestConversations(prisma: PrismaClient, now: Date = new Date()): Promise<void> {
  const existingPatients = await prisma.patient.findMany({
    where: { phoneE164: { startsWith: FIXTURE_PHONE_PREFIX } },
    select: { id: true },
  });
  const existingPatientIds = existingPatients.map((patient) => patient.id);
  if (existingPatientIds.length > 0) {
    const existingConversations = await prisma.conversation.findMany({
      where: { patientId: { in: existingPatientIds } },
      select: { id: true },
    });
    const conversationIds = existingConversations.map((conversation) => conversation.id);
    await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
    await prisma.patient.deleteMany({ where: { id: { in: existingPatientIds } } });
  }

  const longHistory: Array<{ role: MessageRole; content: string }> = [];
  for (let turn = 1; turn <= 15; turn++) {
    longHistory.push({ role: MessageRole.PATIENT, content: `Pergunta de teste numero ${turn} (historico longo).` });
    longHistory.push({ role: MessageRole.AGENT, content: `Resposta de teste numero ${turn} (historico longo).` });
  }

  const fixtures: ConversationFixture[] = [
    {
      phoneSuffix: '1',
      patientName: 'Fixture AWAITING_HUMAN',
      status: ConversationStatus.AWAITING_HUMAN,
      windowExpiresAt: new Date(now.getTime() + 12 * HOUR_MS),
      messages: [
        { role: MessageRole.PATIENT, content: 'Sinto uma dor muito forte no peito, o que eu faco?' },
        { role: MessageRole.AGENT, content: 'Isso pode ser uma emergencia — procure um pronto-socorro agora.' },
      ],
    },
    {
      phoneSuffix: '2',
      patientName: 'Fixture BOT',
      status: ConversationStatus.BOT,
      windowExpiresAt: new Date(now.getTime() + 12 * HOUR_MS),
      messages: [
        { role: MessageRole.PATIENT, content: 'Oi, queria marcar uma consulta.' },
        { role: MessageRole.AGENT, content: 'Claro! Qual procedimento voce procura?' },
      ],
    },
    {
      phoneSuffix: '3',
      patientName: 'Fixture HUMAN',
      status: ConversationStatus.HUMAN,
      windowExpiresAt: new Date(now.getTime() + 12 * HOUR_MS),
      messages: [
        { role: MessageRole.PATIENT, content: 'Preciso falar com uma pessoa, por favor.' },
        { role: MessageRole.HUMAN, content: 'Oi, aqui e a recepcao! Como posso ajudar?' },
      ],
    },
    {
      phoneSuffix: '4',
      patientName: 'Fixture Janela Aberta',
      status: ConversationStatus.BOT,
      windowExpiresAt: new Date(now.getTime() + 23 * HOUR_MS),
      messages: [{ role: MessageRole.PATIENT, content: 'Mensagem recente, dentro da janela de 24h.' }],
    },
    {
      phoneSuffix: '5',
      patientName: 'Fixture Janela Expirada',
      status: ConversationStatus.BOT,
      windowExpiresAt: new Date(now.getTime() - HOUR_MS),
      messages: [{ role: MessageRole.PATIENT, content: 'Mensagem antiga, janela de 24h ja fechada (RN-18).' }],
    },
    {
      phoneSuffix: '6',
      patientName: 'Fixture Historico Longo',
      status: ConversationStatus.BOT,
      windowExpiresAt: new Date(now.getTime() + 12 * HOUR_MS),
      messages: longHistory,
    },
  ];

  for (const fixture of fixtures) {
    const patient = await prisma.patient.create({
      data: { phoneE164: `${FIXTURE_PHONE_PREFIX}${fixture.phoneSuffix}`, name: fixture.patientName },
    });
    const conversation = await prisma.conversation.create({
      data: {
        patientId: patient.id,
        status: fixture.status,
        lastInboundAt: now,
        windowExpiresAt: fixture.windowExpiresAt,
      },
    });
    for (const message of fixture.messages) {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: message.role,
          content: message.content,
          consumedAt: message.role === MessageRole.PATIENT ? now : undefined,
        },
      });
    }
    // AWAITING_HUMAN sem HandoffTicket aberto nunca acontece de verdade —
    // exercita o takeover fechando o ticket junto (achado da Etapa 1/Fase 5).
    if (fixture.status === ConversationStatus.AWAITING_HUMAN) {
      await prisma.handoffTicket.create({
        data: { conversationId: conversation.id, reason: 'RN-02', summary: 'Sinal de urgencia (fixture de teste).' },
      });
    }
  }

  console.log(
    'Seed de conversas concluido:',
    fixtures.map((fixture) => `${fixture.patientName} (${fixture.status})`),
  );
}

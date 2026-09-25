import 'reflect-metadata';
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MessageRole } from '@prisma/client';
import type { Queue as BullQueue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LLM_PORT } from '../src/modules/agent';
import { MESSAGING_PORT } from '../src/modules/messaging';
import { PrismaService } from '../src/shared/database/prisma.service';
import { INBOUND_MESSAGES_QUEUE, inboundJobId } from '../src/shared/queue/queue.tokens';
import { ScriptedLlmPort } from './agent/support/scripted-llm-port';
import { FakeMessagingPort } from './support/fake-messaging-port';
import { uniquePhone } from './support/unique-phone';
import { waitFor } from './support/wait-for';
import { waitForQueueWorkersReady } from './support/wait-for-queues-ready';
import { buildWhatsappTextPayload, signPayload } from './support/whatsapp-payload';

const APP_SECRET = 'test-app-secret-debounce-batching';
// So precisa ser positivo — o teste nunca espera esse tempo passar de
// verdade. Depois das duas mensagens chegarem, o job agendado (ainda
// "delayed" nesse ponto) e promovido na mao (job.promote()) pra rodar
// imediatamente, em vez de esperar o timer real elapsar. Antes disso o
// teste dependia de "a 2a mensagem chegar antes do job da 1a disparar
// sozinho" — uma corrida contra o relogio real que ficava mais apertada
// sob carga da maquina (varios containers Docker concorrendo por CPU) e
// flakava mesmo com janela de 2000ms. Achado do usuario: ampliar a janela
// de novo so adia o proximo flake — o fix de verdade e parar de depender
// de quanto tempo passou.
const DEBOUNCE_MS = 60_000;

describe('Debounce: o que acontece com duas mensagens na mesma janela (Fase 1+3, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let moduleRef: TestingModule;
  let fakeMessagingPort: FakeMessagingPort;
  let scriptedLlmPort: ScriptedLlmPort;

  beforeAll(async () => {
    process.env.MESSAGE_DEBOUNCE_MS = String(DEBOUNCE_MS);
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;

    const { AppModule } = await import('../src/app.module');

    fakeMessagingPort = new FakeMessagingPort();
    scriptedLlmPort = new ScriptedLlmPort([{ text: 'Certo, vou te ajudar com isso.' }]);

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGING_PORT)
      .useValue(fakeMessagingPort)
      .overrideProvider(LLM_PORT)
      .useValue(scriptedLlmPort)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    prisma = moduleRef.get(PrismaService);
    await app.init();
    await waitForQueueWorkersReady(moduleRef);
  });

  afterAll(async () => {
    await app.close();
  });

  async function postMessage(fromPhone: string, text: string, wamid: string) {
    const { payload } = buildWhatsappTextPayload({ fromPhone, text, wamid });
    const rawBody = JSON.stringify(payload);
    const signature = signPayload(rawBody, APP_SECRET);

    return request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(rawBody);
  }

  it(
    'duas mensagens dentro da janela de debounce: AMBAS ficam persistidas E AMBAS entram no turno ' +
      'unico que o orquestrador processa (decisao 1 do plano da Fase 3 — a spec original tinha ' +
      'run(conversation, userMessage: string), que perderia a primeira mensagem)',
    async () => {
      const fromPhone = uniquePhone();
      const wamid1 = `wamid.DEBOUNCE_TEST_1_${fromPhone}`;
      const wamid2 = `wamid.DEBOUNCE_TEST_2_${fromPhone}`;

      const firstResponse = await postMessage(fromPhone, 'queria marcar uma consulta', wamid1);
      expect(firstResponse.status).toBe(200);

      // As duas mensagens chegam em sequencia imediata (sem sleep artificial
      // entre elas) — cada POST so retorna depois que scheduleDebounce
      // termina de rodar (receive-webhook.use-case.ts), entao a 2a mensagem
      // ve o job da 1a ainda "delayed" de forma deterministica, nao por
      // sorte de timing.
      const secondResponse = await postMessage(fromPhone, 'pode ser com o Dr. Filipe', wamid2);
      expect(secondResponse.status).toBe(200);

      // Promove o job agendado (ainda delayed, DEBOUNCE_MS=60s) pra rodar
      // AGORA — em vez de esperar o timer real elapsar (a causa da
      // flakiness sob carga de maquina: ver comentario de DEBOUNCE_MS).
      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { patient: { phoneE164: `+${fromPhone}` } },
      });
      const inboundQueue: BullQueue = moduleRef.get(getQueueToken(INBOUND_MESSAGES_QUEUE));
      const scheduledJob = await inboundQueue.getJob(inboundJobId(conversation.id));
      await scheduledJob?.promote();

      // Espera o pipeline assincrono terminar (processamento do job promovido).
      // waitFor so exige "verdadeiro" — a linha do outbox pode existir
      // (status PENDING) antes do DispatchOutboxJob (fila separada)
      // terminar de enviar de verdade. Espera o status terminal, nao so a
      // existencia da linha (mesmo achado do webhook-echo.e2e-spec.ts,
      // Fase 5: a checagem de janela de 24h no DispatchOutboxJob alargou
      // essa corrida pre-existente).
      await waitFor(async () => {
        const found = await prisma.outboxMessage.findFirst({ where: { toPhoneE164: `+${fromPhone}` } });
        return found?.status === 'PENDING' ? undefined : found;
      });

      // As DUAS mensagens do paciente devem estar salvas — nada se perde
      // na camada de persistencia.
      const patientMessages = await prisma.message.findMany({
        where: { conversation: { patient: { phoneE164: `+${fromPhone}` } }, role: MessageRole.PATIENT },
        orderBy: { createdAt: 'asc' },
      });
      expect(patientMessages.map((m) => m.content)).toEqual([
        'queria marcar uma consulta',
        'pode ser com o Dr. Filipe',
      ]);

      // O PONTO CENTRAL: o LlmPort recebeu as DUAS mensagens no turno, nao
      // so a ultima. Sem isso, "queria marcar uma consulta" desapareceria
      // silenciosamente e o orquestrador so veria "pode ser com o Dr.
      // Filipe", sem o pedido.
      expect(scriptedLlmPort.callCount).toBe(1);
      const [{ messages: sentMessages }] = scriptedLlmPort.receivedInputs;
      const turnMessage = sentMessages[sentMessages.length - 1];
      expect(turnMessage.content).toContain('queria marcar uma consulta');
      expect(turnMessage.content).toContain('pode ser com o Dr. Filipe');

      // Um unico eco (resposta do orquestrador) foi gerado pro turno inteiro.
      const agentMessages = await prisma.message.findMany({
        where: { conversation: { patient: { phoneE164: `+${fromPhone}` } }, role: MessageRole.AGENT },
      });
      expect(agentMessages).toHaveLength(1);
      expect(agentMessages[0].content).toBe('Certo, vou te ajudar com isso.');

      const sentToPhone = fakeMessagingPort.sentMessages.filter((m) => m.to === `+${fromPhone}`);
      expect(sentToPhone).toHaveLength(1);

      // Os DOIS InboundEvent — mesmo o da mensagem cujo job foi cancelado —
      // terminam com processedAt preenchido. Isso nao e sobre idempotencia
      // (essa e garantida pela constraint unica de externalId, nao por
      // processedAt) — e sobre nao deixar o campo sempre nulo para quem for
      // usar isso depois (painel admin, expurgo por retencao).
      const inboundEvent1 = await prisma.inboundEvent.findUnique({ where: { externalId: wamid1 } });
      const inboundEvent2 = await prisma.inboundEvent.findUnique({ where: { externalId: wamid2 } });
      expect(inboundEvent1?.processedAt).not.toBeNull();
      expect(inboundEvent2?.processedAt).not.toBeNull();

      // E as duas Message do paciente ficam marcadas consumidas — o turno fechou.
      const unconsumed = await prisma.message.count({
        where: { conversation: { patient: { phoneE164: `+${fromPhone}` } }, role: MessageRole.PATIENT, consumedAt: null },
      });
      expect(unconsumed).toBe(0);
    },
  );
});

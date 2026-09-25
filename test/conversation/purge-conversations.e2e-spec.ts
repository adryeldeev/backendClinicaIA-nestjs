import 'reflect-metadata';
import { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { AppointmentStatus, ConversationStatus, MessageRole } from '@prisma/client';
import type { Job } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PurgeConversationsJob } from '../../src/modules/conversation/application/purge-conversations.job';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { CLOCK } from '../../src/shared/kernel/clock';
import { FixedClock } from '../support/fixed-clock';
import { uniquePhone } from '../support/unique-phone';

const DAY_MS = 24 * 60 * 60 * 1000;
const FIXED_NOW = new Date('2026-01-15T12:00:00.000Z');
const RETENTION_DAYS = 180;

/**
 * RN-22: expurgo so afeta o CONTEUDO da conversa. Achado do plano da
 * Fase 5 — a spec original nao separava isso: Appointment/Patient tem
 * regra de guarda de atendimento clinico completamente diferente e NUNCA
 * podem ser tocados aqui, mesmo quando pertencem a mesma pessoa cuja
 * conversa expurgou. HandoffTicket.summary tambem e redigido (pode ter
 * texto cru do paciente vindo do guardrail de entrada).
 */
describe('PurgeConversationsJob (RN-22)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let job: PurgeConversationsJob;

  beforeAll(async () => {
    process.env.CONVERSATION_RETENTION_DAYS = String(RETENTION_DAYS);
    // Flag destrutiva, padrao 'false' (env.schema.ts) — estes testes
    // exercitam o comportamento REAL de redacao, entao ligam explicitamente.
    // O caso "flag desligada nao roda" tem describe proprio mais abaixo.
    process.env.RETENTION_PURGE_ENABLED = 'true';
    const { AppModule } = await import('../../src/app.module');

    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(new FixedClock(FIXED_NOW))
      .compile();

    prisma = moduleRef.get(PrismaService);
    job = moduleRef.get(PurgeConversationsJob);
  });

  afterAll(async () => {
    delete process.env.CONVERSATION_RETENTION_DAYS;
    delete process.env.RETENTION_PURGE_ENABLED;
    await moduleRef.close();
  });

  it('conversa velha: mensagem anonimizada, ticket redigido, conversa fechada — Appointment/Patient intactos', async () => {
    const phone = `+${uniquePhone()}`;
    const patient = await prisma.patient.create({ data: { phoneE164: phone } });
    const oldTimestamp = new Date(FIXED_NOW.getTime() - (RETENTION_DAYS + 10) * DAY_MS);
    const conversation = await prisma.conversation.create({
      data: {
        patientId: patient.id,
        status: ConversationStatus.AWAITING_HUMAN,
        context: { nomeColetado: 'Fulano de Tal' },
        lastInboundAt: oldTimestamp,
        // RN-22 decide por lastActivityAt, nao lastInboundAt — sem isso o
        // default do schema (now()) deixaria esta conversa "recente" de
        // verdade e o job nunca a tocaria.
        lastActivityAt: oldTimestamp,
      },
    });
    const message = await prisma.message.create({
      data: { conversationId: conversation.id, role: MessageRole.PATIENT, content: 'estou com dor forte no peito' },
    });
    const ticket = await prisma.handoffTicket.create({
      data: {
        conversationId: conversation.id,
        reason: 'RN-02',
        summary: 'Sinal de urgencia detectado na mensagem do paciente: "estou com dor forte no peito"',
      },
    });

    // Atendimento clinico real do mesmo paciente — precisa sobreviver ao
    // expurgo da conversa intacto, regra de guarda diferente (RN-22 e so
    // sobre conteudo de conversa).
    const clinic = await prisma.clinic.create({
      data: { name: `Clinica Purge ${uniquePhone()}`, timezone: 'America/Fortaleza', addressLine: 'x', phone: `+${uniquePhone()}` },
    });
    const professional = await prisma.professional.create({
      data: { clinicId: clinic.id, name: 'Dr. Purge Teste', specialty: 'Geral' },
    });
    const procedure = await prisma.procedure.create({
      data: { clinicId: clinic.id, name: 'Consulta Purge Teste', durationMin: 30 },
    });
    const appointment = await prisma.appointment.create({
      data: {
        professionalId: professional.id,
        patientId: patient.id,
        procedureId: procedure.id,
        startsAt: new Date(FIXED_NOW.getTime() - (RETENTION_DAYS + 5) * DAY_MS),
        endsAt: new Date(FIXED_NOW.getTime() - (RETENTION_DAYS + 5) * DAY_MS + 30 * 60 * 1000),
        status: AppointmentStatus.CONFIRMED,
      },
    });

    await job.process({} as Job);

    const messageAfter = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(messageAfter.content).not.toContain('dor forte no peito');
    expect(messageAfter.content).toContain('expurgado');
    expect(messageAfter.role).toBe(MessageRole.PATIENT); // forma preservada
    expect(messageAfter.id).toBe(message.id); // linha nao foi apagada

    const ticketAfter = await prisma.handoffTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(ticketAfter.summary).not.toContain('dor forte no peito');
    expect(ticketAfter.reason).toBe('RN-02'); // motivo em si nao e PII, mantido

    const conversationAfter = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conversationAfter.status).toBe(ConversationStatus.CLOSED);
    expect(conversationAfter.context).toEqual({});

    // O ponto central: atendimento clinico do MESMO paciente nunca e tocado.
    const appointmentAfter = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(appointmentAfter.status).toBe(AppointmentStatus.CONFIRMED);
    expect(appointmentAfter.patientId).toBe(patient.id);

    const patientAfter = await prisma.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(patientAfter.phoneE164).toBe(phone);
  });

  it('conversa recente (dentro da retencao) nao e tocada', async () => {
    const phone = `+${uniquePhone()}`;
    const patient = await prisma.patient.create({ data: { phoneE164: phone } });
    const recentTimestamp = new Date(FIXED_NOW.getTime() - 5 * DAY_MS);
    const conversation = await prisma.conversation.create({
      data: { patientId: patient.id, lastInboundAt: recentTimestamp, lastActivityAt: recentTimestamp },
    });
    const message = await prisma.message.create({
      data: { conversationId: conversation.id, role: MessageRole.PATIENT, content: 'mensagem recente, nao deve ser tocada' },
    });

    await job.process({} as Job);

    const messageAfter = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(messageAfter.content).toBe('mensagem recente, nao deve ser tocada');

    const conversationAfter = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conversationAfter.status).not.toBe(ConversationStatus.CLOSED);
  });

  it('assignedUserId sozinho (sem mensagem nova) NAO estende a elegibilidade de expurgo — so mensagem conta como atividade (achado do usuario, LGPD)', async () => {
    const phone = `+${uniquePhone()}`;
    const patient = await prisma.patient.create({ data: { phoneE164: phone } });
    const admin = await prisma.user.create({
      data: { email: `purge-admin-${uniquePhone()}@clinica.test`, passwordHash: 'x', name: 'Admin Purge', role: 'ADMIN' },
    });
    const oldTimestamp = new Date(FIXED_NOW.getTime() - (RETENTION_DAYS + 10) * DAY_MS);
    const conversation = await prisma.conversation.create({
      data: {
        patientId: patient.id,
        status: ConversationStatus.AWAITING_HUMAN,
        lastInboundAt: oldTimestamp,
        lastActivityAt: oldTimestamp,
      },
    });

    // Toque puramente administrativo — sem mensagem nova, sem interacao
    // com o paciente. Isso NAO pode reiniciar o relogio de retencao: fazer
    // isso significaria que uma acao interna (quem assumiu a conversa)
    // estende silenciosamente o prazo de guarda de dado sensivel.
    await prisma.conversation.update({ where: { id: conversation.id }, data: { assignedUserId: admin.id } });
    const afterAssign = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(afterAssign.lastActivityAt.getTime()).toBe(oldTimestamp.getTime()); // updatedAt mudou, lastActivityAt nao

    await job.process({} as Job);

    const conversationAfter = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(conversationAfter.status).toBe(ConversationStatus.CLOSED); // continuou elegivel, expurgou normalmente
  });

  it('conversa ja CLOSED nao e reprocessada', async () => {
    const phone = `+${uniquePhone()}`;
    const patient = await prisma.patient.create({ data: { phoneE164: phone } });
    const closedTimestamp = new Date(FIXED_NOW.getTime() - (RETENTION_DAYS + 10) * DAY_MS);
    const conversation = await prisma.conversation.create({
      data: {
        patientId: patient.id,
        status: ConversationStatus.CLOSED,
        lastInboundAt: closedTimestamp,
        lastActivityAt: closedTimestamp,
      },
    });
    const message = await prisma.message.create({
      data: { conversationId: conversation.id, role: MessageRole.PATIENT, content: 'ja fechada, nao deveria mudar' },
    });

    await job.process({} as Job);

    const messageAfter = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(messageAfter.content).toBe('ja fechada, nao deveria mudar');
  });
});

-- Migration gerada por `prisma migrate dev --create-only` e revisada a
-- mao (regra do CLAUDE.md desde a Fase 4): o diff automatico tambem
-- tentou "corrigir" content_tsv/knowledge_chunk_tsv_idx de novo (mesmo
-- efeito colateral ja documentado — schema.prisma nao consegue expressar
-- indice GIN nem coluna gerada, entao o Prisma sempre ve isso como
-- drift). Essas duas linhas foram removidas — so o que segue e intencional:

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Appointment_status_startsAt_reminderSentAt_idx" ON "Appointment"("status", "startsAt", "reminderSentAt");

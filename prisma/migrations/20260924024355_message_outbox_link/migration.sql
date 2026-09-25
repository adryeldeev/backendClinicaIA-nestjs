-- Editado a mao (mesmo motivo de sempre, ver CLAUDE.md): o diff automatico
-- do Prisma tambem tentava apagar knowledge_chunk_embedding_hnsw/
-- knowledge_chunk_tsv_idx e a generated column content_tsv — objetos
-- criados via SQL puro, fora do schema.prisma. Mantido so o real.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "outboxMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_outboxMessageId_key" ON "Message"("outboxMessageId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_outboxMessageId_fkey" FOREIGN KEY ("outboxMessageId") REFERENCES "OutboxMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

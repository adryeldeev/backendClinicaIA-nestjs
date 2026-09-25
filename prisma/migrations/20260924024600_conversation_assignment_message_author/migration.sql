-- Editado a mao (mesmo motivo de sempre, ver CLAUDE.md): o diff automatico
-- do Prisma tambem tentava apagar knowledge_chunk_embedding_hnsw/
-- knowledge_chunk_tsv_idx e a generated column content_tsv — objetos
-- criados via SQL puro, fora do schema.prisma. Mantido so o real.

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "assignedUserId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "authorUserId" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_actorId_entityType_entityId_action_createdAt_idx" ON "AuditLog"("actorId", "entityType", "entityId", "action", "createdAt");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

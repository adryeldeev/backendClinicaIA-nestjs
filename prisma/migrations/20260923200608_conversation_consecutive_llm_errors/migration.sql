-- AlterTable
-- Editado a mao: o diff automatico do Prisma tentava tambem apagar os
-- indices knowledge_chunk_embedding_hnsw/knowledge_chunk_tsv_idx e a
-- generated column content_tsv (migrations 20260922015409 e anteriores) —
-- eles foram criados via SQL puro, fora do schema.prisma, entao o Prisma
-- os enxerga como "drift" e tenta desfazer. Mantido so o ALTER real.
ALTER TABLE "Conversation" ADD COLUMN     "consecutiveLlmErrors" INTEGER NOT NULL DEFAULT 0;

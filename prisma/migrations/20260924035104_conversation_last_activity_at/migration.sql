-- Editado a mao (mesmo motivo de sempre, ver CLAUDE.md): o diff automatico
-- do Prisma tambem tentava apagar knowledge_chunk_embedding_hnsw/
-- knowledge_chunk_tsv_idx e a generated column content_tsv. Mantido so o
-- real, e o backfill NAO usa "agora" (o que o Prisma geraria sozinho com
-- DEFAULT CURRENT_TIMESTAMP) -- para linhas ja existentes, o valor mais
-- correto historicamente e o melhor sinal de atividade real ja disponivel
-- (lastInboundAt), com updatedAt/createdAt como fallback. Usar "agora"
-- daria uma sobrevida artificial de retencao a conversas que ja deveriam
-- estar elegiveis para expurgo (RN-22) no momento desta migration.

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "lastActivityAt" TIMESTAMP(3);

-- Backfill: melhor sinal historico disponivel por linha, nao "agora".
UPDATE "Conversation"
SET "lastActivityAt" = COALESCE("lastInboundAt", "updatedAt", "createdAt");

ALTER TABLE "Conversation" ALTER COLUMN "lastActivityAt" SET NOT NULL;
-- Default so pra escrita direta de teste que nao passa pelo repositorio —
-- todo caminho real de producao (PrismaConversationRepository.create,
-- PrismaMessageRepository.create) estampa explicitamente a partir do Clock.
ALTER TABLE "Conversation" ALTER COLUMN "lastActivityAt" SET DEFAULT CURRENT_TIMESTAMP;

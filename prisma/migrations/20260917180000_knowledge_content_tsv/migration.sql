-- Migration manual (nao gerada pelo Prisma) — coluna gerada tsvector nao
-- e representavel pelo Prisma alem de `Unsupported("tsvector")` (que so
-- declara a existencia da coluna, nao o GENERATED ALWAYS AS ... STORED).
--
-- Recria o que a Fase 0 (20260915143834_manual_indexes) ja tinha criado
-- e que a Fase 2 (20260917141451_appointment_late_cancellation) derrubou
-- sem querer: `prisma migrate dev` viu uma coluna nao representada no
-- schema.prisma e "corrigiu" o que considerou drift. Prevencao pra nao
-- repetir: schema.prisma agora declara `contentTsv Unsupported("tsvector")`
-- em KnowledgeChunk (ver modelo) — o Prisma passa a saber que a coluna
-- existe, mesmo sem entender como ela e gerada.

ALTER TABLE "KnowledgeChunk"
  ADD COLUMN content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED;

CREATE INDEX knowledge_chunk_tsv_idx
  ON "KnowledgeChunk" USING gin (content_tsv);

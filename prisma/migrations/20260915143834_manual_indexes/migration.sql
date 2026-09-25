-- Migration manual (nao gerada pelo Prisma) — ver spec secao 7.
-- O Prisma `migrate dev` nao sabe gerar: extensao, indice parcial (WHERE),
-- coluna GENERATED ALWAYS AS ... STORED, nem indice HNSW.

-- 1. Extensao pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Impede dois agendamentos ativos no mesmo slot do mesmo profissional
--    (ultima linha de defesa contra double-booking; a primeira e o lock
--    otimista via Appointment.version)
CREATE UNIQUE INDEX appointment_active_slot_unique
  ON "Appointment" ("professionalId", "startsAt")
  WHERE status IN ('HELD', 'CONFIRMED');

-- 3. Indice HNSW (vetorial) — adiado para a Fase 4 (RAG), depois que a base
--    de conhecimento for populada, conforme instrucao da spec.

-- 4. Busca textual em portugues para o hibrido RRF (Fase 4)
ALTER TABLE "KnowledgeChunk"
  ADD COLUMN content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED;

CREATE INDEX knowledge_chunk_tsv_idx
  ON "KnowledgeChunk" USING gin (content_tsv);

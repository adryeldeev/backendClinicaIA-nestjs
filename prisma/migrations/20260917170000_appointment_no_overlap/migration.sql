-- Migration manual (nao gerada pelo Prisma) — constraint de exclusao nao e
-- representavel no schema.prisma, mesma razao das outras migrations
-- manuais (ver 20260915143834_manual_indexes).
--
-- appointment_active_slot_unique (indice unico parcial em
-- professionalId+startsAt) impedia dois agendamentos com o MESMO inicio,
-- mas Procedure.durationMin e variavel: uma consulta de 60min as 14:00 e
-- uma de 30min as 14:30 tem startsAt diferentes, passam as duas pelo
-- indice unico, e se sobrepoem de verdade (14:00-15:00 vs 14:30-15:00).
-- A constraint de exclusao substitui o indice e cobre qualquer
-- sobreposicao de intervalo, nao so o mesmo instante exato.

CREATE EXTENSION IF NOT EXISTS btree_gist;

DROP INDEX "appointment_active_slot_unique";

-- tsrange, nao tstzrange: startsAt/endsAt sao "timestamp without time
-- zone" (Prisma DateTime, UTC ingenuo — ver CLAUDE.md "todo horario e
-- gravado em UTC"). tstzrange exigiria cast implicito timestamp->
-- timestamptz, que e STABLE (depende do TimeZone da sessao), nao
-- IMMUTABLE — Postgres recusa funcao nao-imutavel em expressao de indice
-- ("functions in index expression must be marked IMMUTABLE", confirmado
-- na mao contra o Postgres real antes de escrever esta versao).
ALTER TABLE "Appointment"
  ADD CONSTRAINT appointment_no_overlap
  EXCLUDE USING gist (
    "professionalId" WITH =,
    tsrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE (status IN ('HELD', 'CONFIRMED'));

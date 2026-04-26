-- ============================================================
-- Migration 051 — DB hardening (additive)
--
-- Three safe, additive changes following an audit of the schema:
--
--   1. CHECK on learning_events.event_type
--      Values were documented in a comment but not enforced.
--      A typo like 'consilidation_run' silently pollutes the feed.
--
--   2. embedding_model column on chunks / knowledge_entities / proposition
--      Currently the model is implicit (voyage-3 everywhere via lib/embeddings.js).
--      When we migrate provider or version, transition rows are opaque without
--      this column. Backfill defaults to 'voyage-3'.
--
--   3. NOT NULL on created_at where currently nullable.
--      Old tables (002–018 era) declared `DEFAULT now()` without NOT NULL.
--      New tables (036, 038, 029...) declare NOT NULL DEFAULT now().
--      Sweep brings the older tables in line. Backfill NULL → now() first.
--
-- Additif uniquement — aucun DROP, aucun ALTER destructif.
-- À appliquer manuellement via Supabase SQL Editor (même pattern que 049).
-- ============================================================

-- ── 1. CHECK on learning_events.event_type ──────────────────
--
-- Values mirror the documented set in 017_learning_events.sql.
-- DO block lets us skip if the constraint is somehow already there
-- (idempotent re-run safety).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.learning_events'::regclass
      AND conname = 'learning_events_event_type_check'
  ) THEN
    ALTER TABLE learning_events
      ADD CONSTRAINT learning_events_event_type_check
      CHECK (event_type IN (
        'rule_added',
        'rule_weakened',
        'correction_saved',
        'consolidation_run',
        'consolidation_reverted'
      ));
  END IF;
END $$;

COMMENT ON CONSTRAINT learning_events_event_type_check ON learning_events IS
  'Mirrors the documented set in 017_learning_events.sql. Update both when adding a new event_type.';

-- ── 2. embedding_model on vector tables ─────────────────────
--
-- Column added with default = 'voyage-3' (current model in lib/embeddings.js).
-- Existing rows backfilled to the same default. Nullable allowed for rows
-- whose embedding is itself NULL (e.g. chunks without successful embedding).

ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS embedding_model text;

ALTER TABLE knowledge_entities
  ADD COLUMN IF NOT EXISTS embedding_model text;

ALTER TABLE proposition
  ADD COLUMN IF NOT EXISTS embedding_model text;

UPDATE chunks
  SET embedding_model = 'voyage-3'
  WHERE embedding IS NOT NULL AND embedding_model IS NULL;

UPDATE knowledge_entities
  SET embedding_model = 'voyage-3'
  WHERE embedding IS NOT NULL AND embedding_model IS NULL;

UPDATE proposition
  SET embedding_model = 'voyage-3'
  WHERE embedding IS NOT NULL AND embedding_model IS NULL;

COMMENT ON COLUMN chunks.embedding_model IS
  'Provider+model that generated this embedding (e.g. voyage-3). NULL when embedding is NULL. Required so cross-provider migrations can filter rows to re-embed.';
COMMENT ON COLUMN knowledge_entities.embedding_model IS
  'Provider+model that generated this embedding (e.g. voyage-3). NULL when embedding is NULL.';
COMMENT ON COLUMN proposition.embedding_model IS
  'Provider+model that generated this embedding (e.g. voyage-3). NULL when embedding is NULL.';

-- ── 3. NOT NULL sweep on created_at ─────────────────────────
--
-- Tables created in 002-018 era declared `DEFAULT now()` without NOT NULL.
-- Newer migrations (029, 036, 038...) use NOT NULL DEFAULT now().
-- Backfill any pre-existing NULLs to now(), then enforce NOT NULL.
--
-- Each block is wrapped in a DO so a single missing table doesn't abort
-- the whole migration (e.g. if a table was renamed or dropped).

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'clients',
    'personas',
    'conversations',
    'messages',
    'corrections',
    'knowledge_files',
    'knowledge_entities',
    'knowledge_relations',
    'usage_log',
    'scenario_files',
    'persona_metrics_daily'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Skip if table doesn't exist (idempotent on partial schemas)
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = t
    ) THEN
      CONTINUE;
    END IF;

    -- Skip if created_at column doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'created_at'
    ) THEN
      CONTINUE;
    END IF;

    -- Skip if already NOT NULL (idempotent re-run)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t
        AND column_name = 'created_at' AND is_nullable = 'NO'
    ) THEN
      CONTINUE;
    END IF;

    -- Backfill NULLs (use now() — old rows lose nothing meaningful)
    EXECUTE format('UPDATE %I SET created_at = now() WHERE created_at IS NULL', t);

    -- Enforce NOT NULL
    EXECUTE format('ALTER TABLE %I ALTER COLUMN created_at SET NOT NULL', t);
  END LOOP;
END $$;

-- ── 4. Sanity probe (commented — run manually post-migration) ──
-- SELECT
--   c.relname AS table_name,
--   a.attname AS column_name,
--   a.attnotnull AS not_null
-- FROM pg_attribute a
-- JOIN pg_class c ON c.oid = a.attrelid
-- WHERE a.attname = 'created_at'
--   AND c.relkind = 'r'
--   AND c.relnamespace = 'public'::regnamespace
-- ORDER BY c.relname;

-- ============================================================
-- 034 — Async graph extraction status for knowledge_files
--
-- Decouples upload (sync, fast) from LLM graph extraction
-- (async, processed by cron-consolidate).
-- ============================================================

ALTER TABLE knowledge_files
  ADD COLUMN IF NOT EXISTS extraction_status text NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending', 'processing', 'done', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS extraction_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extraction_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS extraction_error text,
  ADD COLUMN IF NOT EXISTS contributed_by uuid;

-- Pre-existing rows: already embedded and (maybe) graph-extracted synchronously.
-- Mark them done so the cron doesn't re-extract everything.
UPDATE knowledge_files
   SET extraction_status = 'done'
 WHERE extraction_status = 'pending'
   AND created_at < now() - interval '5 minutes';

-- Index for cron scan: scan pending first, oldest first.
CREATE INDEX IF NOT EXISTS idx_knowledge_files_extraction_pending
  ON knowledge_files (created_at)
  WHERE extraction_status = 'pending';

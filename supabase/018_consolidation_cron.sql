-- ============================================================
-- Migration 018 — Support for cron-driven consolidation
-- Adds a timestamp so the cron can prioritize stale personas.
-- ============================================================

ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS last_consolidation_at timestamptz;

-- Index helps the cron's ORDER BY last_consolidation_at ASC NULLS FIRST
CREATE INDEX IF NOT EXISTS idx_personas_last_consolidation
  ON personas (last_consolidation_at NULLS FIRST);

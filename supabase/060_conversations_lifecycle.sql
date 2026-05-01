-- ============================================================
-- Migration 060 — conversations.lifecycle_state + external_lead_ref
--
-- Two additions to the conversations table to support the external
-- draft surface (PR-1 V3.6.5 / Breakcold workflow).
--
-- 1. lifecycle_state — explicit state-machine column populated by the
--    /api/v2/draft endpoint at conv creation. Sidebar filters in the
--    Setclone Studio UI read this column to bucket convs into "À envoyer
--    / En attente réponse / Actives / Closed". V1 only writes
--    'awaiting_send' on creation ; setter-driven transitions land in a
--    later PR. NULL is allowed for legacy rows pre-060.
--
--      awaiting_send  — draft generated, not yet sent to the prospect
--      awaiting_reply — operator sent the message, waiting on prospect
--      active         — prospect replied, ongoing thread
--      closed         — outcome reached (RDV / hors-cible / abandon)
--
-- 2. external_lead_ref — stable identifier from the calling system,
--    formatted as "<connector>:<id>" (e.g. "breakcold:abc123"). Used
--    by /api/v2/draft for idempotency : a re-fired n8n webhook returns
--    the existing conversation instead of creating a duplicate.
--    Partial unique index lets legacy convs with NULL coexist (only
--    enforces uniqueness among non-null refs).
--
-- Additif uniquement, idempotent. Cf plan tu-vois-quand-on-tranquil-music.md.
-- ============================================================

-- ── 1. conversations.lifecycle_state ────────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS lifecycle_state text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_lifecycle_state_check'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_lifecycle_state_check
      CHECK (lifecycle_state IS NULL OR lifecycle_state IN (
        'awaiting_send',
        'awaiting_reply',
        'active',
        'closed'
      ));
  END IF;
END $$;

COMMENT ON COLUMN conversations.lifecycle_state IS
  'Explicit state for sidebar bucketing. Populated by /api/v2/draft on creation (awaiting_send). NULL = legacy row created before this column existed (pre-060). Cf migration 060.';

-- ── 2. conversations.external_lead_ref ──────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS external_lead_ref text;

-- Unique only among non-null refs : legacy rows + manually-created convs
-- (no external system) keep NULL. A re-fired webhook with the same
-- "breakcold:abc123" hits the existing row → /api/v2/draft idempotency.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_external_lead_ref
  ON conversations (external_lead_ref)
  WHERE external_lead_ref IS NOT NULL;

COMMENT ON COLUMN conversations.external_lead_ref IS
  'Stable identifier from the calling integration (format <connector>:<id>, e.g. "breakcold:abc123"). Drives /api/v2/draft idempotency. NULL for manually-created convs. Cf migration 060.';

-- ── 3. Index for sidebar filter ─────────────────────────────
-- Sidebar queries: "convs of persona X with lifecycle_state='awaiting_send'".
-- Index on (persona_id, lifecycle_state) keeps it scan-free even with
-- thousands of convs per persona at scale.
CREATE INDEX IF NOT EXISTS idx_conversations_persona_lifecycle
  ON conversations (persona_id, lifecycle_state)
  WHERE lifecycle_state IS NOT NULL;

-- ── Verification queries (manual) ──────────────────────────
--   SELECT lifecycle_state, COUNT(*) FROM conversations GROUP BY lifecycle_state;
--   SELECT external_lead_ref FROM conversations WHERE external_lead_ref IS NOT NULL LIMIT 5;
--   SELECT conname FROM pg_constraint WHERE conname = 'conversations_lifecycle_state_check';
--   SELECT indexname FROM pg_indexes
--     WHERE indexname IN ('idx_conversations_external_lead_ref', 'idx_conversations_persona_lifecycle');

-- ── Rollback (if needed) ───────────────────────────────────
-- DROP INDEX IF EXISTS idx_conversations_persona_lifecycle;
-- DROP INDEX IF EXISTS idx_conversations_external_lead_ref;
-- ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_lifecycle_state_check;
-- ALTER TABLE conversations DROP COLUMN IF EXISTS external_lead_ref;
-- ALTER TABLE conversations DROP COLUMN IF EXISTS lifecycle_state;

-- 047_corrections_proposition_drained.sql
--
-- Chunk 2 follow-up (Task 2.5.11 bridge) — adds idempotency column on
-- corrections so the protocole-vivant cron can also drain implicit signals
-- (copy_paste_out, regen_rejection) and explicit corrections without
-- re-processing them.
--
-- Distinct from `promoted_to_rule_index` (réservé pour le flow de
-- consolidation correction → rule) — c'est seulement pour le bridge
-- vers `proposition`.
-- ============================================================

ALTER TABLE corrections
  ADD COLUMN IF NOT EXISTS proposition_drained_at timestamptz;

COMMENT ON COLUMN corrections.proposition_drained_at IS
  'Set when the row has been processed by the protocole-vivant cron (feedback-event-to-proposition). NULL = not yet drained for proposition extraction. Distinct from the consolidation rule-promotion flow.';

-- Partial index : the cron only ever queries WHERE proposition_drained_at IS NULL
-- AND source_channel IN (...). Partial index keeps the lookup cheap regardless
-- of total corrections volume.
CREATE INDEX IF NOT EXISTS idx_corrections_proposition_undrained
  ON corrections (created_at)
  WHERE proposition_drained_at IS NULL;

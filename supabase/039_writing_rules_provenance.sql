-- 039_writing_rules_provenance.sql
-- Tracks which corrections were promoted to which writingRule index,
-- enabling aggregate-weight-based eviction at the writingRules cap.
-- Idempotent.

ALTER TABLE corrections
  ADD COLUMN IF NOT EXISTS promoted_to_rule_index INTEGER;

CREATE INDEX IF NOT EXISTS idx_corrections_promoted
  ON corrections(persona_id, promoted_to_rule_index)
  WHERE promoted_to_rule_index IS NOT NULL;

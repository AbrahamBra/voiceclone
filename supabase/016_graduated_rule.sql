-- 016_graduated_rule.sql
-- Track which synthesized rule a correction was graduated into (enables rollback)

ALTER TABLE corrections
  ADD COLUMN IF NOT EXISTS graduated_rule text;

CREATE INDEX IF NOT EXISTS idx_corrections_graduated
  ON corrections(persona_id, graduated_rule) WHERE status = 'graduated';

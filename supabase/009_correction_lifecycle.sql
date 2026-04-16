-- 009_correction_lifecycle.sql
-- Adds confidence scoring and lifecycle status to corrections

ALTER TABLE corrections
  ADD COLUMN IF NOT EXISTS confidence numeric(3,2) DEFAULT 0.8,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active'
    CHECK (status IN ('active', 'graduated', 'archived'));

CREATE INDEX IF NOT EXISTS idx_corrections_status
  ON corrections(persona_id, status) WHERE status = 'active';

-- Backfill: existing corrections get confidence 0.8
UPDATE corrections SET confidence = 0.8 WHERE confidence IS NULL;
UPDATE corrections SET status = 'active' WHERE status IS NULL;

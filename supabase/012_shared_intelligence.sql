-- 012: Shared intelligence between clones + contributor tracking

-- 1. Intelligence source FK (one level, no self-reference)
ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS intelligence_source_id uuid REFERENCES personas(id)
  CHECK (intelligence_source_id IS NULL OR intelligence_source_id != id);

-- 2. Contributor tracking
ALTER TABLE corrections
  ADD COLUMN IF NOT EXISTS contributed_by uuid REFERENCES clients(id);

ALTER TABLE knowledge_files
  ADD COLUMN IF NOT EXISTS contributed_by uuid REFERENCES clients(id);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_corrections_contributed_by
  ON corrections(contributed_by);
CREATE INDEX IF NOT EXISTS idx_knowledge_files_contributed_by
  ON knowledge_files(contributed_by);
CREATE INDEX IF NOT EXISTS idx_personas_intelligence_source
  ON personas(intelligence_source_id)
  WHERE intelligence_source_id IS NOT NULL;

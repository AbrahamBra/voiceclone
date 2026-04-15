-- 005_smart_graph.sql
-- Smart graph: confidence decay + chunk provenance for RRF fusion

ALTER TABLE knowledge_entities
  ADD COLUMN IF NOT EXISTS last_matched_at timestamptz DEFAULT now();

ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS source_path text;

CREATE INDEX IF NOT EXISTS idx_entities_last_matched
  ON knowledge_entities(persona_id, last_matched_at);
CREATE INDEX IF NOT EXISTS idx_chunks_source_path
  ON chunks(persona_id, source_path);

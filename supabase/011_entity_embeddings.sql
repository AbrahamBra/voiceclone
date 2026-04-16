-- Migration: Add embedding column to knowledge_entities for semantic matching
-- Replicates the pattern from 003_chunks_rag.sql (hnsw + match function)

ALTER TABLE knowledge_entities
  ADD COLUMN IF NOT EXISTS embedding vector(1024);

CREATE INDEX IF NOT EXISTS idx_entities_embedding
  ON knowledge_entities
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Semantic match function for entities (mirrors match_chunks pattern)
CREATE OR REPLACE FUNCTION match_entities(
  query_embedding vector(1024),
  match_persona_id uuid,
  match_threshold float DEFAULT 0.4,
  match_count int DEFAULT 8
)
RETURNS TABLE (id uuid, name text, type text, description text, confidence numeric, similarity float)
LANGUAGE SQL STABLE
AS $$
  SELECT
    e.id,
    e.name,
    e.type,
    e.description,
    e.confidence,
    1 - (e.embedding <=> query_embedding) as similarity
  FROM knowledge_entities e
  WHERE e.persona_id = match_persona_id
    AND e.confidence >= 0.6
    AND e.embedding IS NOT NULL
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;

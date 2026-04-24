-- 045_proposition_embedding_voyage.sql
--
-- Switch proposition.embedding from vector(1536) to vector(1024) to reuse
-- the project's existing Voyage AI setup (lib/embeddings.js, voyage-3).
-- Avoids introducing an OpenAI API key dependency.
--
-- Safe at this point: no proposition rows exist yet (Chunk 2 pipeline
-- not yet writing into the table).
-- ============================================================

-- 1. Drop HNSW index (required before altering vector column type).
DROP INDEX IF EXISTS idx_proposition_embedding;

-- 2. Resize the column. USING NULL is safe — no rows yet.
ALTER TABLE proposition
  ALTER COLUMN embedding TYPE vector(1024) USING NULL;

-- 3. Recreate HNSW index on the new dim.
CREATE INDEX IF NOT EXISTS idx_proposition_embedding
  ON proposition USING hnsw (embedding vector_cosine_ops);

-- 4. Rebuild match_propositions RPC with the new signature.
DROP FUNCTION IF EXISTS match_propositions(uuid, text, vector, float, int);

CREATE OR REPLACE FUNCTION match_propositions(
  match_document_id uuid,
  match_target_kind text,
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.85,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  similarity float,
  proposed_text text,
  intent text,
  target_kind text,
  target_section_id uuid,
  count int
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.id,
    1 - (p.embedding <=> query_embedding) AS similarity,
    p.proposed_text,
    p.intent,
    p.target_kind,
    p.target_section_id,
    p.count
  FROM proposition p
  WHERE p.document_id = match_document_id
    AND p.status = 'pending'
    AND p.embedding IS NOT NULL
    AND (match_target_kind IS NULL OR p.target_kind = match_target_kind)
    AND 1 - (p.embedding <=> query_embedding) >= match_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
$$;

COMMENT ON FUNCTION match_propositions IS
  'Protocol v2 semantic dedup (voyage-3, 1024 dims) — returns pending propositions similar to query_embedding in the given document (optional target_kind filter). Similarity = 1 - cosine distance.';

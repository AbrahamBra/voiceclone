-- 044_match_propositions.sql
--
-- Chunk 2 Task 2.1 — RPC for semantic dedup of pending propositions.
--
-- Scope: returns the top-K pending propositions for a given document, ranked
-- by cosine similarity against a 1536-dim query embedding, filtered by an
-- optional target_kind. Only pending propositions are candidates (accepted /
-- rejected / merged are out — their signal is already resolved).
--
-- Uses the HNSW index idx_proposition_embedding (migration 038).
-- Threshold-side note: spec §3 uses 0.85 by default; caller may override.
--
-- Reserved migration numbers 041-043 kept free for Chunk 2.5 follow-ups
-- (rule_proposals, n4_paused_until, promoted_to_rule_index).
-- ============================================================

CREATE OR REPLACE FUNCTION match_propositions(
  match_document_id uuid,
  match_target_kind text,
  query_embedding vector(1536),
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
  'Protocol v2 semantic dedup — returns pending propositions similar to query_embedding in the given document (optional target_kind filter). Similarity = 1 - cosine distance.';

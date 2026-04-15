-- Update match_chunks to return source_path for RRF fusion
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(1024),
  match_persona_id uuid,
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 5
)
RETURNS TABLE (id uuid, content text, similarity float, source_path text)
LANGUAGE SQL STABLE
AS $$
  SELECT
    c.id,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity,
    c.source_path
  FROM chunks c
  WHERE c.persona_id = match_persona_id
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

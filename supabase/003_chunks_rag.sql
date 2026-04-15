-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Chunks table for RAG semantic retrieval
CREATE TABLE IF NOT EXISTS public.chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid NOT NULL REFERENCES public.personas(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'knowledge_file',
  content text NOT NULL,
  embedding vector(1024),
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chunks_persona ON public.chunks(persona_id);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON public.chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Match function for semantic search
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(1024),
  match_persona_id uuid,
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 5
)
RETURNS TABLE (id uuid, content text, similarity float)
LANGUAGE SQL STABLE
AS $$
  SELECT
    c.id,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  FROM chunks c
  WHERE c.persona_id = match_persona_id
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 058_personas_embeddings_status.sql
--
-- Embeddings status visibility on personas — surface the failure mode
-- "/api/clone times out → persona row inserted but embedding pipeline never
-- finished, so chunks/knowledge_files are empty". Today the user discovers
-- this 5 min later in /chat ("why is the clone so dumb?"). With this column,
-- the wizard surfaces a warning at creation, and any later UI can show a
-- "RAG incomplete — relancer l'indexation" banner.
--
-- States:
--   pending  — default. Set on insert. Means "embedding pipeline hasn't
--              reached the finalize step yet". A persona stuck in pending
--              after >2 min = the cron job died (Vercel function killed
--              before res.json).
--   ready    — all embedding sources for this persona succeeded.
--   partial  — at least one source (linkedin_post / knowledge_file /
--              document) failed but at least one succeeded. The clone is
--              usable but RAG quality is degraded.
--   failed   — the embedding pipeline ran but every source threw, OR the
--              VOYAGE_API_KEY / OpenAI key is unset.
-- ============================================================

ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS embeddings_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE personas
  ADD CONSTRAINT personas_embeddings_status_check
  CHECK (embeddings_status IN ('pending', 'ready', 'partial', 'failed'));

COMMENT ON COLUMN personas.embeddings_status IS
  'pending = embedding finalize step not reached (or function killed). ready = all sources embedded. partial = some embeddings failed but at least one succeeded. failed = no embeddings produced.';

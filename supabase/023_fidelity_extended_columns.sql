-- fidelity_scores was silently extended at runtime: lib/fidelity.js inserts
-- score_cosine, collapse_index, draft_style, source_style, embedding_variance
-- and variance_loss, but 015_fidelity_scores.sql never declared them.
-- Any fresh env re-bootstrapped from migrations was breaking on INSERT or
-- returning null for the cockpit's "collapse" gauge and style fingerprint.

ALTER TABLE fidelity_scores
  ADD COLUMN IF NOT EXISTS score_cosine integer,
  ADD COLUMN IF NOT EXISTS collapse_index integer,
  ADD COLUMN IF NOT EXISTS draft_style jsonb,
  ADD COLUMN IF NOT EXISTS source_style jsonb,
  ADD COLUMN IF NOT EXISTS embedding_variance float,
  ADD COLUMN IF NOT EXISTS variance_loss float;

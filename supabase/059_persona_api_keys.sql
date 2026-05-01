-- ============================================================
-- Migration 059 — persona_api_keys
--
-- Per-persona API keys for the external draft surface (PR-1 V3.6.5).
-- A persona can have N keys (rotation without downtime, multi-tenant
-- usage : Breakcold + Zapier + n8n test simultaneously). Identified by
-- a label, authenticated via SHA-256 hash of the raw key.
--
-- Auth flow:
--   1. Caller sends header `x-api-key: <raw_key>`
--   2. Server hashes raw_key (sha256), looks up persona_api_keys.key_hash
--   3. If found AND revoked_at IS NULL → grant access to the row's persona
--   4. last_used_at touched best-effort
--
-- Raw keys are NEVER stored — only the hash. Generated server-side at
-- /api/v2/persona-api-keys POST and shown ONCE to the operator.
-- ============================================================

CREATE TABLE IF NOT EXISTS persona_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  key_hash text NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

-- Lookup path: hash of the incoming x-api-key header → row.
-- Unique because two raw keys hashing to the same value would collide
-- regardless of which persona they belong to (sha256 collision = system-wide).
CREATE UNIQUE INDEX IF NOT EXISTS idx_persona_api_keys_key_hash
  ON persona_api_keys (key_hash);

-- List/revoke path: the brain page shows all keys for a given persona.
CREATE INDEX IF NOT EXISTS idx_persona_api_keys_persona_id
  ON persona_api_keys (persona_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE persona_api_keys IS
  'Per-persona API keys authenticating external integrations (Breakcold n8n template, Zapier, etc.). One persona can have N keys identified by label. Cf migration 059 / PR-1 V3.6.5.';

COMMENT ON COLUMN persona_api_keys.key_hash IS
  'SHA-256 hex digest of the raw key. Raw key is shown to the operator ONCE at generation time and never persisted.';

COMMENT ON COLUMN persona_api_keys.label IS
  'Human-readable label set by the operator (e.g. "breakcold-prod", "n8n-test"). Optional but recommended for rotation hygiene.';

COMMENT ON COLUMN persona_api_keys.last_used_at IS
  'Touched best-effort by the auth middleware on each successful request. Null = never used since generation.';

COMMENT ON COLUMN persona_api_keys.revoked_at IS
  'Soft-delete: set to now() on revoke. Auth middleware MUST reject any key with revoked_at IS NOT NULL.';

-- ── Verification queries (manual) ──────────────────────────
--   SELECT COUNT(*) FROM persona_api_keys;
--   SELECT indexname FROM pg_indexes WHERE tablename = 'persona_api_keys';

-- ── Rollback (if needed) ───────────────────────────────────
-- DROP INDEX IF EXISTS idx_persona_api_keys_persona_id;
-- DROP INDEX IF EXISTS idx_persona_api_keys_key_hash;
-- DROP TABLE IF EXISTS persona_api_keys;

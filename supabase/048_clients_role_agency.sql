-- ============================================================
-- Migration 048 — Agency hierarchy on clients (Chunk 5 prep)
--
-- Adds two columns to `clients` to support the 3-level hierarchy
-- of the protocole-vivant spec :
--
--   agency_admin (agency_id NULL — the row IS the agency)
--   setter       (agency_id = agency_admin.id)
--   client       (agency_id = agency_admin.id, end-customer of the agency)
--
-- The setter ↔ persona/clone many-to-many assignment uses the existing
-- `persona_shares` table — no new join table needed. A setter assigned to
-- multiple agency clients gets one persona_shares row per persona.
--
-- Additif uniquement, idempotent. ON DELETE SET NULL on the FK so that
-- deleting an agency unlinks (rather than cascades) its setters/clients.
-- ============================================================

-- 1. Discriminator + parent FK on clients
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'setter'
    CHECK (role IN ('agency_admin', 'setter', 'client')),
  ADD COLUMN IF NOT EXISTS agency_id uuid REFERENCES clients(id) ON DELETE SET NULL;

-- 2. Backfill : the platform admin row used by authenticateRequest is the
-- agency_admin of the platform itself. All other existing rows stay as
-- 'setter' (the safest default — they are real users of the app today).
UPDATE clients
   SET role = 'agency_admin'
 WHERE access_code = '__admin__'
   AND role = 'setter';

-- 3. Indexes
-- Partial : agency_id is NULL for agency_admin rows; we only index the
-- non-null half (the lookup is always "find rows under agency X").
CREATE INDEX IF NOT EXISTS idx_clients_agency_id
  ON clients (agency_id)
  WHERE agency_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_role
  ON clients (role);

-- 4. Self-documentation
COMMENT ON COLUMN clients.role IS
  'agency_admin: the row IS the agency (agency_id NULL). setter: belongs to an agency, manages its clients'' personas via persona_shares. client: end-customer of the agency, claims a persona via /train/{token}.';

COMMENT ON COLUMN clients.agency_id IS
  'Self-ref to the clients row that is the agency_admin parent. NULL for agency_admin rows themselves. Setters and end-clients share the same agency_id (their parent agency_admin).';

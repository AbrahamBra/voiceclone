-- ============================================================
-- Migration 025 — Sprint 0 Foundation
--
-- Scope (per audit/roadmap.md §Sprint 0 + audit/sprint-0-recon.md, Option A) :
--   0.c — Organizations table + organization_id on clients/personas/conversations
--         + persona_shares.role (default 'claim')
--   0.b — scenario_canonical enum (11 values) + conversations.scenario_type column
--         with soft legacy backfill. conversations.scenario (text) kept intact
--         for dual-write compatibility during the transition period.
--
-- Guarantees :
--   - Additive only. No DROP. No destructive UPDATE on legacy columns.
--   - Idempotent. Safe to re-apply.
--   - Transactional. Full rollback if any step fails.
--   - RLS consistent with 019_rls_baseline.sql (service_role bypass).
--
-- Application : manual via Supabase SQL Editor.
-- Verification queries listed at bottom (run after COMMIT).
-- Rollback notes at bottom (all reversible).
-- ============================================================

BEGIN;

-- ============================================================
-- 0.c — Organizations + agence-first readiness
-- ============================================================

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all ON organizations;
CREATE POLICY service_role_all ON organizations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE clients       ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE personas      ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);

CREATE INDEX IF NOT EXISTS idx_clients_org       ON clients(organization_id);
CREATE INDEX IF NOT EXISTS idx_personas_org      ON personas(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversations_org ON conversations(organization_id);

-- Backfill : one solo organization per existing client, owned by that client.
-- Uses NOT EXISTS to make the INSERT idempotent across re-runs.
INSERT INTO organizations (name, owner_client_id)
SELECT 'Solo — ' || c.name, c.id
FROM clients c
WHERE NOT EXISTS (
  SELECT 1 FROM organizations o WHERE o.owner_client_id = c.id
);

UPDATE clients c SET organization_id = o.id
FROM organizations o
WHERE o.owner_client_id = c.id AND c.organization_id IS NULL;

UPDATE personas p SET organization_id = c.organization_id
FROM clients c
WHERE p.client_id = c.id
  AND p.organization_id IS NULL
  AND c.organization_id IS NOT NULL;

UPDATE conversations cv SET organization_id = c.organization_id
FROM clients c
WHERE cv.client_id = c.id
  AND cv.organization_id IS NULL
  AND c.organization_id IS NOT NULL;

-- persona_shares.role — low-cost foundation for agence-first role model.
-- 'claim' = default for existing rows (receiver claimed a share).
-- 'owner' / 'operator' / 'client_viewer' will be populated when the agency
-- role UI lands (Phase 2 per roadmap).
ALTER TABLE persona_shares
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'claim';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'persona_shares_role_check'
  ) THEN
    ALTER TABLE persona_shares
      ADD CONSTRAINT persona_shares_role_check
      CHECK (role IN ('owner', 'operator', 'client_viewer', 'claim'));
  END IF;
END $$;

-- ============================================================
-- 0.b — Canonical scenarios enum
-- ============================================================
-- Source of truth for the 11 values : audit/philosophy.md §6.
-- Keep in lockstep with src/lib/scenarios.js (SCENARIOS map).

DO $$ BEGIN
  CREATE TYPE scenario_canonical AS ENUM (
    'post_autonome',
    'post_lead_magnet',
    'post_actu',
    'post_prise_position',
    'post_framework',
    'post_cas_client',
    'post_coulisse',
    'DM_1st',
    'DM_relance',
    'DM_reply',
    'DM_closing'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS scenario_type scenario_canonical;

CREATE INDEX IF NOT EXISTS idx_conversations_scenario_type
  ON conversations(scenario_type) WHERE scenario_type IS NOT NULL;

-- Soft backfill : map legacy conversations.scenario (text) → enum.
-- Leaves scenario_type NULL where mapping is ambiguous (safe, nullable column).
-- Uses personas.type as a fallback disambiguator for generic values like 'default'.
-- personas.type values (per migration 008) : 'posts' | 'dm' | 'both'.
UPDATE conversations cv
SET scenario_type = CASE
  -- Exact canonical matches (future-proof for new rows written post-migration)
  WHEN cv.scenario = 'post_autonome'       THEN 'post_autonome'::scenario_canonical
  WHEN cv.scenario = 'post_lead_magnet'    THEN 'post_lead_magnet'::scenario_canonical
  WHEN cv.scenario = 'post_actu'           THEN 'post_actu'::scenario_canonical
  WHEN cv.scenario = 'post_prise_position' THEN 'post_prise_position'::scenario_canonical
  WHEN cv.scenario = 'post_framework'      THEN 'post_framework'::scenario_canonical
  WHEN cv.scenario = 'post_cas_client'     THEN 'post_cas_client'::scenario_canonical
  WHEN cv.scenario = 'post_coulisse'       THEN 'post_coulisse'::scenario_canonical
  WHEN cv.scenario = 'DM_1st'              THEN 'DM_1st'::scenario_canonical
  WHEN cv.scenario = 'DM_relance'          THEN 'DM_relance'::scenario_canonical
  WHEN cv.scenario = 'DM_reply'            THEN 'DM_reply'::scenario_canonical
  WHEN cv.scenario = 'DM_closing'          THEN 'DM_closing'::scenario_canonical
  -- Legacy generic values : use persona.type to disambiguate
  WHEN cv.scenario IN ('post', 'posts') THEN 'post_autonome'::scenario_canonical
  WHEN cv.scenario = 'dm'               THEN 'DM_1st'::scenario_canonical
  WHEN cv.scenario = 'default' THEN
    CASE p.type
      WHEN 'posts' THEN 'post_autonome'::scenario_canonical
      WHEN 'dm'    THEN 'DM_1st'::scenario_canonical
      WHEN 'both'  THEN 'post_autonome'::scenario_canonical  -- conservative default
      ELSE NULL
    END
  -- Partial heuristics (best-effort ; leave NULL if unsure rather than guess wrong)
  WHEN cv.scenario ILIKE '%autonom%'        THEN 'post_autonome'::scenario_canonical
  WHEN cv.scenario ILIKE '%lead%magnet%'    THEN 'post_lead_magnet'::scenario_canonical
  WHEN cv.scenario ILIKE '%actu%'           THEN 'post_actu'::scenario_canonical
  WHEN cv.scenario ILIKE '%prise%position%' THEN 'post_prise_position'::scenario_canonical
  WHEN cv.scenario ILIKE '%framework%'      THEN 'post_framework'::scenario_canonical
  WHEN cv.scenario ILIKE '%cas%client%'     THEN 'post_cas_client'::scenario_canonical
  WHEN cv.scenario ILIKE '%coulisse%'
    OR cv.scenario ILIKE '%transpar%'       THEN 'post_coulisse'::scenario_canonical
  WHEN cv.scenario ILIKE '%relance%'        THEN 'DM_relance'::scenario_canonical
  WHEN cv.scenario ILIKE '%reply%'
    OR cv.scenario ILIKE '%repons%'         THEN 'DM_reply'::scenario_canonical
  WHEN cv.scenario ILIKE '%clos%'           THEN 'DM_closing'::scenario_canonical
  WHEN cv.scenario ILIKE 'dm%'
    OR cv.scenario ILIKE '%first%'          THEN 'DM_1st'::scenario_canonical
  ELSE NULL
END
FROM personas p
WHERE cv.persona_id = p.id AND cv.scenario_type IS NULL;

COMMIT;

-- ============================================================
-- Post-apply verification (run manually after COMMIT)
-- ============================================================
-- Expected : all zero once migration completes.
--   SELECT COUNT(*) AS orphan_clients  FROM clients       WHERE organization_id IS NULL;
--   SELECT COUNT(*) AS orphan_personas FROM personas      WHERE organization_id IS NULL;
--   SELECT COUNT(*) AS orphan_convs    FROM conversations WHERE organization_id IS NULL;
--
-- Inspect scenario mapping coverage (NULL scenario_type rows are legacy
-- values the soft backfill could not confidently map — acceptable) :
--   SELECT scenario, scenario_type, COUNT(*) AS n
--     FROM conversations GROUP BY 1, 2 ORDER BY n DESC;
--
-- Confirm default role on existing shares :
--   SELECT role, COUNT(*) FROM persona_shares GROUP BY 1;
--
-- Confirm RLS still enabled on all critical tables :
--   SELECT tablename, rowsecurity
--     FROM pg_tables
--    WHERE schemaname = 'public'
--      AND tablename IN ('organizations','clients','personas','conversations','persona_shares')
--    ORDER BY tablename;

-- ============================================================
-- Rollback (manual, only if needed ; migration is safe to keep)
-- ============================================================
-- BEGIN;
--   ALTER TABLE conversations DROP COLUMN IF EXISTS scenario_type;
--   DROP INDEX IF EXISTS idx_conversations_scenario_type;
--   DROP TYPE IF EXISTS scenario_canonical;
--   ALTER TABLE persona_shares DROP CONSTRAINT IF EXISTS persona_shares_role_check;
--   ALTER TABLE persona_shares DROP COLUMN IF EXISTS role;
--   ALTER TABLE conversations DROP COLUMN IF EXISTS organization_id;
--   ALTER TABLE personas      DROP COLUMN IF EXISTS organization_id;
--   ALTER TABLE clients       DROP COLUMN IF EXISTS organization_id;
--   DROP INDEX IF EXISTS idx_conversations_org;
--   DROP INDEX IF EXISTS idx_personas_org;
--   DROP INDEX IF EXISTS idx_clients_org;
--   DROP TABLE IF EXISTS organizations CASCADE;
-- COMMIT;

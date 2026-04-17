-- ============================================================
-- Migration 019 — Row-Level Security baseline
--
-- Strategy: "defense in depth without breaking anything"
--
--   1. Enable RLS on every sensitive table.
--   2. DO NOT add policies for anon/authenticated roles → they see nothing.
--   3. service_role has BYPASSRLS by default in Supabase → backend keeps
--      working with zero code changes.
--
-- Net effect:
--   - Backend (service_role): full access, unchanged.
--   - Attacker with anon/public key: cannot read or write these tables.
--   - Infra tables (rate_limit_buckets, sessions) are left unrestricted
--     because they carry no client PII and may be read by system jobs.
--
-- This migration is idempotent (safe to re-run).
-- ============================================================

-- Client-scoped tables
ALTER TABLE IF EXISTS clients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS personas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS conversations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS usage_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS persona_shares      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS share_tokens        ENABLE ROW LEVEL SECURITY;

-- Persona-scoped tables (knowledge & learning)
ALTER TABLE IF EXISTS knowledge_entities  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS knowledge_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS knowledge_files     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS chunks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS corrections         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS scenario_files      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS fidelity_scores     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS persona_metrics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS learning_events     ENABLE ROW LEVEL SECURITY;

-- Explicit documentation policies: service_role bypasses RLS via BYPASSRLS,
-- but declaring a permissive policy for it makes intent clear and survives
-- any future change to the role's default privileges.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'clients', 'personas', 'conversations', 'messages', 'usage_log',
    'persona_shares', 'share_tokens',
    'knowledge_entities', 'knowledge_relations', 'knowledge_files', 'chunks',
    'corrections', 'scenario_files', 'fidelity_scores',
    'persona_metrics_daily', 'learning_events'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Skip if table doesn't exist
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      CONTINUE;
    END IF;

    -- Drop old policy if re-running
    EXECUTE format('DROP POLICY IF EXISTS service_role_all ON %I', t);

    -- Service role: full access (redundant with BYPASSRLS, but explicit)
    EXECUTE format(
      'CREATE POLICY service_role_all ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

-- Sanity check: list which tables now have RLS enabled
-- (run this query after migration to verify)
-- SELECT schemaname, tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;

-- ============================================================
-- Migration 065 — RLS baseline V2 (close the gap left by 019)
--
-- Audit 2026-05-02 revealed 3 sensitive tables created after the 019
-- baseline that never had RLS enabled or a service_role policy declared:
--
--   - prospect_heat       (mig 021) — per-message engagement scores
--   - business_outcomes   (mig 022) — RDV/deal outcomes (revenue data)
--   - persona_api_keys    (mig 059) — sha256 hashes of raw API keys
--
-- All three carry data that crosses tenant boundaries and would leak
-- competitive intel (prospect engagement), revenue (deal outcomes), or
-- auth-secret-adjacent metadata (which persona has which key labels) if
-- exposed via the anon Supabase key.
--
-- Defense-in-depth before beta open: backend uses service_role and
-- bypasses RLS, but a misconfigured anon-key call should hit a deny
-- wall, not the table.
--
-- This migration is idempotent (safe to re-run).
-- ============================================================

-- Enable RLS
ALTER TABLE IF EXISTS prospect_heat       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS business_outcomes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS persona_api_keys    ENABLE ROW LEVEL SECURITY;

-- Service role: full access (redundant with BYPASSRLS, but explicit so
-- intent survives any future change to the role's default privileges).
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'prospect_heat',
    'business_outcomes',
    'persona_api_keys'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS service_role_all ON %I', t);
    EXECUTE format(
      'CREATE POLICY service_role_all ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

-- Sanity check (manual, post-deploy):
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename IN ('prospect_heat', 'business_outcomes', 'persona_api_keys');
-- All three rows should show rowsecurity = true.

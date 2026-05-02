-- ============================================================
-- Migration 066 — RLS audit helper + close last 2 gaps
--
-- Companion to test/rls-isolation.test.js, which proves the anon
-- key cannot read or write any public table.
--
-- 1. Closes 2 remaining gaps after audit 2026-05-02:
--      - sessions          (auth tokens — CRITICAL)
--      - rate_limit_buckets (low PII, defense-in-depth)
--
--    Both are accessed exclusively by the backend (service_role,
--    BYPASSRLS) — enabling RLS = zero behavior change for the app,
--    only blocks the anon key.
--
-- 2. Adds list_public_tables_rls() — a SECURITY DEFINER function
--    callable only by service_role that returns every public table
--    with its rowsecurity flag. Used by the isolation test to
--    auto-discover tables (so a future migration that creates a
--    table without RLS is caught automatically).
--
-- Idempotent (safe to re-run).
-- ============================================================

-- ── 1. Close remaining gaps ─────────────────────────────────

ALTER TABLE IF EXISTS sessions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS rate_limit_buckets   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY['sessions', 'rate_limit_buckets'];
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

-- ── 2. Audit helpers ────────────────────────────────────────
-- service_role only — anon/authenticated cannot enumerate.

-- 2.a Tables + RLS flag.
CREATE OR REPLACE FUNCTION public.list_public_tables_rls()
RETURNS TABLE(tablename text, rowsecurity boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.tablename::text, t.rowsecurity
  FROM pg_catalog.pg_tables t
  WHERE t.schemaname = 'public'
  ORDER BY t.tablename;
$$;

REVOKE ALL ON FUNCTION public.list_public_tables_rls() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_public_tables_rls() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_tables_rls() TO service_role;

-- 2.b Policies — used to detect permissive grants to anon/authenticated/PUBLIC.
-- A policy with role 'public' (the default when no TO clause is given) or
-- 'anon' / 'authenticated' would let the anon key bypass our deny-by-default
-- baseline.  This app's only intended policy role is 'service_role'.
CREATE OR REPLACE FUNCTION public.list_public_table_policies()
RETURNS TABLE(tablename text, policyname text, roles text[], cmd text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.tablename::text, p.policyname::text, p.roles::text[], p.cmd::text
  FROM pg_catalog.pg_policies p
  WHERE p.schemaname = 'public'
  ORDER BY p.tablename, p.policyname;
$$;

REVOKE ALL ON FUNCTION public.list_public_table_policies() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_public_table_policies() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_table_policies() TO service_role;

-- Sanity checks (manual, post-deploy):
--   SELECT * FROM list_public_tables_rls() WHERE rowsecurity = false;     -- expected 0 rows
--   SELECT * FROM list_public_table_policies()
--     WHERE roles && ARRAY['anon','authenticated','public'];               -- expected 0 rows

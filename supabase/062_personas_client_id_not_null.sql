-- Migration 062 — personas.client_id NOT NULL
--
-- Context: api/clone.js inserted client_id=null whenever auth.isAdmin (admin
-- can create personas freely). Result: 18 orphan personas in prod (1 active
-- = boni-yai, 17 inactive duplicates from /create retries on mohamed-camara,
-- mory-fod-cisse, ahmet-akyurek). Orphans are invisible to all non-admin
-- clients via api/personas.js (filtered by client_id) and break api/v2/draft
-- since PR #195 (hard-fail on missing persistence link).
--
-- Two-part fix:
--   1. Code (api/clone.js): admin-created personas now own a client_id
--      via fallback to the __admin__ client row instead of null.
--   2. Data (scripts/fix-orphan-personas.js, applied 2026-05-02):
--        - 13 inactive orphans with 0 attachments → hard-deleted
--        - 1 inactive orphan colliding on (admin, slug) → renamed to
--          "<slug>-legacy-<short_id>"
--        - 4 orphans (1 active boni-yai + 3 inactive with attachments)
--          patched client_id = admin
--   3. This migration enforces NOT NULL at the DB level so the bug class
--      cannot reappear even if the code regresses.
--
-- Safety check before applying:
--   SELECT COUNT(*) FROM personas WHERE client_id IS NULL;  -- expect 0

ALTER TABLE personas
  ALTER COLUMN client_id SET NOT NULL;

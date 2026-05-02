-- ============================================================
-- Migration 067 — Close FK gaps that block hard-delete cascade
--
-- The privacy page promises a "right to erasure" (RGPD Art. 17),
-- but the current /api/account/delete only soft-deletes because 5
-- FK constraints have no ON DELETE clause (= NO ACTION = blocks
-- DELETE on the parent).
--
-- This migration fixes those 5 FKs:
--
--   usage_log.client_id              → SET NULL  (preserve 10-year billing aggregate, anonymize the link)
--   usage_log.persona_id             → SET NULL  (same)
--   personas.intelligence_source_id  → SET NULL  (depending clone survives, loses source link)
--   corrections.contributed_by       → SET NULL  (correction stays attached to persona, attribution lost)
--   knowledge_files.contributed_by   → SET NULL  (same)
--
-- After this migration, DELETE FROM clients WHERE id = X cascades
-- the rest naturally (personas, conversations, messages, knowledge,
-- protocols, etc. already have ON DELETE CASCADE).
--
-- Idempotent: drops + recreates each constraint.
-- ============================================================

-- ── 1. Make usage_log.client_id nullable ───────────────────
-- Required for SET NULL to work. The aggregate column still
-- captures the billing total; only the FK pointer is severed
-- when the owning client is deleted.
ALTER TABLE usage_log ALTER COLUMN client_id DROP NOT NULL;

-- ── 2. Re-create FKs with ON DELETE SET NULL ───────────────
-- usage_log
ALTER TABLE usage_log DROP CONSTRAINT IF EXISTS usage_log_client_id_fkey;
ALTER TABLE usage_log
  ADD CONSTRAINT usage_log_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

ALTER TABLE usage_log DROP CONSTRAINT IF EXISTS usage_log_persona_id_fkey;
ALTER TABLE usage_log
  ADD CONSTRAINT usage_log_persona_id_fkey
  FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE SET NULL;

-- personas (self-FK to source persona for shared intelligence)
ALTER TABLE personas DROP CONSTRAINT IF EXISTS personas_intelligence_source_id_fkey;
ALTER TABLE personas
  ADD CONSTRAINT personas_intelligence_source_id_fkey
  FOREIGN KEY (intelligence_source_id) REFERENCES personas(id) ON DELETE SET NULL;

-- corrections (agency contributor attribution — added by mig 012)
ALTER TABLE corrections DROP CONSTRAINT IF EXISTS corrections_contributed_by_fkey;
ALTER TABLE corrections
  ADD CONSTRAINT corrections_contributed_by_fkey
  FOREIGN KEY (contributed_by) REFERENCES clients(id) ON DELETE SET NULL;

-- knowledge_files (same)
ALTER TABLE knowledge_files DROP CONSTRAINT IF EXISTS knowledge_files_contributed_by_fkey;
ALTER TABLE knowledge_files
  ADD CONSTRAINT knowledge_files_contributed_by_fkey
  FOREIGN KEY (contributed_by) REFERENCES clients(id) ON DELETE SET NULL;

-- ── Sanity check (manual, post-deploy) ──────────────────────
-- The 5 constraints above should appear with delete_rule = 'SET NULL':
--   SELECT tc.table_name, kcu.column_name, rc.delete_rule
--   FROM information_schema.table_constraints tc
--   JOIN information_schema.referential_constraints rc
--     ON tc.constraint_name = rc.constraint_name
--   JOIN information_schema.key_column_usage kcu
--     ON tc.constraint_name = kcu.constraint_name
--   WHERE tc.table_name IN ('usage_log', 'personas', 'corrections', 'knowledge_files')
--     AND rc.delete_rule = 'SET NULL'
--   ORDER BY tc.table_name, kcu.column_name;

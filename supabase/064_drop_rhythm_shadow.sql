-- 062_drop_rhythm_shadow.sql
-- Sprint A purge — protocol underutilization audit (2026-05-01).
--
-- The rhythm_shadow table accumulated 180 rows in production over the
-- shadow-mode lifecycle. No code path other than diagnostic scripts
-- (scripts/critic-prod-{usage,check}.js, also removed in this sprint)
-- ever read from it. Cross-persona evaluation v1.2 had already concluded
-- that the structural metrics persisted here measure "LLM déraillé"
-- rather than persona-specific voice drift, so the shadow signal was
-- never going to be promoted to GUARD anyway.
--
-- The critic itself (lib/critic/rhythmCritic.js evaluateAgainstPersona)
-- still runs synchronously and pushes V1/V2 voice violations into the
-- pipeline rewrite path — only the DB persistence layer is dropped.
--
-- Reversible : recreate from supabase/020_rhythm_shadow.sql if a future
-- effort wants to instrument shadow signals again.

DROP INDEX IF EXISTS idx_rhythm_shadow_persona_created;
DROP INDEX IF EXISTS idx_rhythm_shadow_conv;
DROP INDEX IF EXISTS idx_rhythm_shadow_flag;
DROP TABLE IF EXISTS rhythm_shadow;

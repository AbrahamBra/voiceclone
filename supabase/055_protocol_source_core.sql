-- ============================================================
-- Migration 055 — Protocole vivant : dimension source_core
--
-- Ajoute la dimension "source de prospect" comme axe orthogonal au scenario_type
-- (lifecycle stage). Permet à un persona d'avoir 1 doc global + N playbooks
-- source-specific qui réutilisent toute l'infra existante (template/fork via
-- owner_kind + parent_template_id, learning loop via propositions/artifacts).
--
-- Spec: docs/superpowers/specs/.../tu-vois-quand-on-tranquil-music.md
--   (pivot architectural 2026-04-30 : extension de protocol_document plutôt
--    que nouvelles tables playbook_template/playbook).
--
-- Sémantique :
--   - protocol_document.source_core IS NULL = doc global (voix/valeurs/
--     persona/offre/règles d'or) — comportement existant, inchangé.
--   - protocol_document.source_core = 'visite_profil' (etc.) = playbook
--     source-specific (stratégie, cadence, messages, règles propres).
--   - 1 persona peut avoir 1 doc global + N docs source-specific
--     (tous status='active', filtrés par source_core au chat).
--   - Template universel : owner_kind='template' + source_core != NULL.
--   - Fork persona : owner_kind='persona' + source_core != NULL +
--     parent_template_id pointant vers le template universel.
--   - Instances per-setter (ex: "Spyer Alec Henry") = sections/artifacts
--     à l'intérieur du doc, PAS un enum value.
--
-- Cohabite avec 038 (protocol_document/section/artifact), 054 (maturity),
-- 040 (training signals). Additif uniquement, idempotent.
-- ============================================================

-- ── 1. protocol_document.source_core ─────────────────────────
-- 6 catégories core. CHECK plutôt qu'enum type pour permettre l'extension
-- légère plus tard si une 7ème catégorie émerge (ex: 'dr_envoyee' pour
-- "ajout outbound" si distinct de dr_recue inbound — à clarifier).
ALTER TABLE protocol_document
  ADD COLUMN IF NOT EXISTS source_core text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'protocol_document_source_core_check'
  ) THEN
    ALTER TABLE protocol_document
      ADD CONSTRAINT protocol_document_source_core_check
      CHECK (source_core IS NULL OR source_core IN (
        'visite_profil',
        'dr_recue',
        'interaction_contenu',
        'premier_degre',
        'spyer',
        'sales_nav'
      ));
  END IF;
END $$;

COMMENT ON COLUMN protocol_document.source_core IS
  'Source de prospect (NULL = doc global voix/valeurs ; sinon = playbook spécifique). '
  'Catégories core V1: visite_profil, dr_recue, interaction_contenu, premier_degre, spyer, sales_nav. '
  'Instances per-setter (ex: "Spyer Alec Henry") vivent dans les sections/artifacts du doc. '
  'Cf migration 055.';

-- ── 2. conversations.source_core ─────────────────────────────
-- Dimension orthogonale à scenario_type (DM_1st/relance/reply/closing,
-- migration 025). Détermine quel playbook (s'il existe) est mergé au
-- protocole global au moment du chat.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS source_core text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_source_core_check'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_source_core_check
      CHECK (source_core IS NULL OR source_core IN (
        'visite_profil',
        'dr_recue',
        'interaction_contenu',
        'premier_degre',
        'spyer',
        'sales_nav'
      ));
  END IF;
END $$;

COMMENT ON COLUMN conversations.source_core IS
  'Origine du lead pour cette conversation (orthogonal à scenario_type). '
  'Sélectionne le playbook source-specific à merger au protocole global au chat. '
  'NULL = pas de playbook source-specific, comportement protocole global seul. '
  'Cf migration 055.';

-- ── 3. Indexes ───────────────────────────────────────────────
-- Lookup persona's playbook for a given source_core (call path: chat.js
-- → getActivePlaybookForSource). Partial index on active docs only,
-- conforme au pattern de idx_protocol_document_active.
CREATE INDEX IF NOT EXISTS idx_protocol_document_owner_source
  ON protocol_document (owner_kind, owner_id, source_core)
  WHERE status = 'active';

-- Inspection / agrégation par source_core.
CREATE INDEX IF NOT EXISTS idx_conversations_source_core
  ON conversations (source_core)
  WHERE source_core IS NOT NULL;

-- ── 4. Verification queries (à exécuter manuellement post-apply) ──
-- Expected: zéro orphelin, contraintes posées, indexes présents.
--
--   SELECT COUNT(*) FROM protocol_document WHERE source_core IS NOT NULL;
--   SELECT COUNT(*) FROM conversations WHERE source_core IS NOT NULL;
--   SELECT conname FROM pg_constraint
--     WHERE conname IN ('protocol_document_source_core_check',
--                       'conversations_source_core_check');
--   SELECT indexname FROM pg_indexes
--     WHERE indexname IN ('idx_protocol_document_owner_source',
--                         'idx_conversations_source_core');

-- ── 5. Rollback notes (si nécessaire) ────────────────────────
-- DROP INDEX IF EXISTS idx_conversations_source_core;
-- DROP INDEX IF EXISTS idx_protocol_document_owner_source;
-- ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_source_core_check;
-- ALTER TABLE conversations DROP COLUMN IF EXISTS source_core;
-- ALTER TABLE protocol_document DROP CONSTRAINT IF EXISTS protocol_document_source_core_check;
-- ALTER TABLE protocol_document DROP COLUMN IF EXISTS source_core;

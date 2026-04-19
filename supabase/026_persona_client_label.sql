-- ============================================================
-- Migration 026 — Persona client_label (Sprint 2 item 1)
--
-- Scope (per audit/roadmap.md §Sprint 2.1) :
--   Ajoute un champ texte libre `client_label` sur personas pour
--   identifier le CLIENT FINAL (end-customer) pour qui le clone est
--   construit. Utilisé par l'agence multi-clients pour scoper ses
--   personas par marque/persona cliente.
--
--   Différent de personas.client_id (= compte agence au sens auth)
--   et de organizations.id (= tenant agence). Ici : simple label
--   utilisateur, pas un FK, pas de contrainte.
--
--   Prépare Sprint 2.2 (Hub search/filtres par client).
--
-- Guarantees :
--   - Additive only. No DROP. No destructive UPDATE.
--   - Idempotent. Safe to re-apply.
--   - Null-friendly : les personas existants restent valides.
--
-- Rollback :
--   ALTER TABLE personas DROP COLUMN IF EXISTS client_label;
--   DROP INDEX IF EXISTS idx_personas_client_label;
-- ============================================================

ALTER TABLE personas ADD COLUMN IF NOT EXISTS client_label text;

-- Index composite pour le Hub futur (filtre par org + search par label).
-- B-tree suffit : recherche exacte et ILIKE 'foo%' y passent.
CREATE INDEX IF NOT EXISTS idx_personas_client_label
  ON personas(organization_id, client_label)
  WHERE client_label IS NOT NULL;

-- Verification :
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'personas' AND column_name = 'client_label';
--   -- expected : client_label | text | YES

-- ============================================================
-- Migration 056 — corrections.kind (remplace les préfixes texte)
--
-- api/feedback.js encode aujourd'hui le type de signal dans la première
-- ligne de `correction` via des préfixes : "[VALIDATED]", "[CLIENT_VALIDATED]",
-- "[EXCELLENT]", "[COPY_PASTE_OUT]", "[REGEN_REJECTED]". Le panel Intelligence
-- (GET /api/feedback) filtre ensuite via `text.startsWith(...)` pour distinguer
-- les "deduced rules" (vraies corrections) des marqueurs entity-boost.
--
-- C'est fragile : un changement de wording côté serveur casse la lecture.
-- On déplace la sémantique dans une colonne dédiée.
--
-- Mapping :
--   correction démarre par '[VALIDATED]'        → kind='validated'
--   correction démarre par '[CLIENT_VALIDATED]' → kind='client_validated'
--   correction démarre par '[EXCELLENT]'        → kind='excellent'
--   correction démarre par '[COPY_PASTE_OUT]'   → kind='copy_paste_out'
--   correction démarre par '[REGEN_REJECTED]'   → kind='regen_rejection'
--   tout le reste                               → kind='rule' (vraie règle déduite)
--
-- Le GET filtrera désormais par `kind = 'rule'` au lieu de scanner les préfixes.
-- Additif uniquement, idempotent.
-- ============================================================

-- ── 1. Ajout de la colonne ───────────────────────────────────
ALTER TABLE corrections
  ADD COLUMN IF NOT EXISTS kind text;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'corrections_kind_check'
  ) THEN
    ALTER TABLE corrections
      ADD CONSTRAINT corrections_kind_check
      CHECK (kind IS NULL OR kind IN (
        'rule',
        'validated',
        'client_validated',
        'excellent',
        'copy_paste_out',
        'regen_rejection'
      ));
  END IF;
END $$;

COMMENT ON COLUMN corrections.kind IS
  'Type de signal. NULL = legacy (avant migration 056). '
  'rule = correction/règle déduite (affichée dans le panel Intelligence). '
  'validated/client_validated/excellent = boost confiance entités, pas une règle. '
  'copy_paste_out/regen_rejection = signaux implicites (poids réduit). '
  'Cf migration 056.';

-- ── 2. Backfill des lignes existantes ────────────────────────
-- Idempotent grâce à `WHERE kind IS NULL` — la migration peut être rejouée.
UPDATE corrections SET kind = 'validated'
  WHERE kind IS NULL AND correction LIKE '[VALIDATED]%';

UPDATE corrections SET kind = 'client_validated'
  WHERE kind IS NULL AND correction LIKE '[CLIENT_VALIDATED]%';

UPDATE corrections SET kind = 'excellent'
  WHERE kind IS NULL AND correction LIKE '[EXCELLENT]%';

UPDATE corrections SET kind = 'copy_paste_out'
  WHERE kind IS NULL AND correction LIKE '[COPY_PASTE_OUT]%';

UPDATE corrections SET kind = 'regen_rejection'
  WHERE kind IS NULL AND correction LIKE '[REGEN_REJECTED]%';

-- Tout le reste = vraie règle déduite (accept, save_rule, save_rule_direct,
-- diff implicite, default correction…). Pas de risque de faux positif :
-- les 5 préfixes sont contrôlés côté serveur.
UPDATE corrections SET kind = 'rule'
  WHERE kind IS NULL;

-- ── 3. Index pour le GET (filtre par persona + kind) ─────────
CREATE INDEX IF NOT EXISTS idx_corrections_persona_kind
  ON corrections (persona_id, kind, created_at DESC);

-- ── 4. Verification (à exécuter manuellement post-apply) ─────
--   SELECT kind, COUNT(*) FROM corrections GROUP BY kind ORDER BY 2 DESC;
--   SELECT COUNT(*) FROM corrections WHERE kind IS NULL;  -- doit être 0
--   SELECT conname FROM pg_constraint WHERE conname = 'corrections_kind_check';
--   SELECT indexname FROM pg_indexes WHERE indexname = 'idx_corrections_persona_kind';

-- ── 5. Rollback (si nécessaire) ──────────────────────────────
-- DROP INDEX IF EXISTS idx_corrections_persona_kind;
-- ALTER TABLE corrections DROP CONSTRAINT IF EXISTS corrections_kind_check;
-- ALTER TABLE corrections DROP COLUMN IF EXISTS kind;

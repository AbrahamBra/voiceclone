-- 023_rhythm_loop.sql
-- Fondations de la boucle de feedback rythme :
--   1. Corpus gold persona-relatif (distance distributionnelle)
--   2. Capture du delta draft -> version envoyée (label implicite)
--   3. Log de préférences pairwise (label explicite, coût marginal ~nul)
-- Phase 1 : plomberie uniquement, zéro scoring. Les seuils viendront plus tard
-- par calibration auto sur ces données (Mahalanobis vs gold, puis Bradley-Terry
-- via `choix` sur rhythm_prefs une fois ~100 pairs accumulés).
--
-- Idempotent.

-- ------------------------------------------------------------
-- 1. messages : flag gold + version envoyée
-- ------------------------------------------------------------
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS is_gold boolean NOT NULL DEFAULT false;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sent_version text;

COMMENT ON COLUMN messages.is_gold IS
  'Marqué manuellement = exemple de référence du rythme persona. Ancre distributionnelle pour le critic.';
COMMENT ON COLUMN messages.sent_version IS
  'Version effectivement envoyée si editée après génération. NULL = envoyée telle quelle. Le diff content -> sent_version est un label implicite de correction.';

-- Index partiel : seuls les golds sont lus pour calculer la baseline persona.
CREATE INDEX IF NOT EXISTS idx_messages_gold_persona
  ON messages(conversation_id)
  WHERE is_gold = true;

-- ------------------------------------------------------------
-- 2. rhythm_prefs : pairwise preferences (label explicite)
-- ------------------------------------------------------------
-- Stocké comme (winner, loser) plutôt que (a, b, winner) pour agrégation directe
-- Bradley-Terry. `context_kind` distingue les sources (rewrite vs A/B manuel etc.).

CREATE TABLE IF NOT EXISTS rhythm_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid REFERENCES personas(id) ON DELETE CASCADE NOT NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,

  winner_text text NOT NULL,
  loser_text text NOT NULL,

  -- Snapshots métriques au moment du choix (évite de recalculer si le module Signal B change).
  winner_signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  loser_signals jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- 'rewrite'   : original vs. rewrite post-critic
  -- 'manual_ab' : deux drafts proposés à Abraham pour tagging
  -- 'edit'      : pré-édition (draft) vs. post-édition (sent) — dérivé de messages.sent_version
  context_kind text NOT NULL CHECK (context_kind IN ('rewrite', 'manual_ab', 'edit')),

  rater text,  -- email ou 'implicit' pour les edits auto-dérivés
  notes text,

  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rhythm_prefs_persona_created
  ON rhythm_prefs(persona_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rhythm_prefs_context
  ON rhythm_prefs(persona_id, context_kind);

-- RLS : même stratégie que 019 — service_role bypass, anon bloqué.
ALTER TABLE rhythm_prefs ENABLE ROW LEVEL SECURITY;

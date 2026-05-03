-- Migration 071 — Brain V1 arbitrage : contradictions + merge history
--
-- Pourquoi : la refonte cerveau V1 promeut l'arbitrage en first-class
-- workflow (status banner → contradictions → propositions batch).
-- Aujourd'hui :
--   1. Les contradictions entre propositions sont DÉTECTÉES par
--      scripts/detect-contradictions-nicolas.js +
--      scripts/merge-synonyms-and-list-contradictions.js mais STOCKÉES
--      en MD statique (docs/decisions/contradictions-nicolas-...). Pas
--      de cycle de vie en BDD, pas de surface UI.
--   2. Les auto-merges synonymes (cosine ≥ 0.85, append source_refs)
--      sont irréversibles : la prop B est consommée dans A sans trace
--      de ce qu'elle disait, donc impossible de split-back si l'auto-merge
--      était faux.
--
-- Ce que cette migration ajoute :
--   1. Table `proposition_contradiction` — paire ordonnée détectée
--      contradictoire, avec status (open|resolved|punted) et action
--      résolutive (keep_a|keep_b|both_false_positive|reject_both).
--   2. Table `proposition_merge_history` — snapshot du B mergé pour
--      auto-merges (et plus tard pour user_arbitrage_keep_*),
--      permettant un split-back traçable.
--
-- Conséquences code (PRs successifs sur cette branche) :
--   - GET /api/v2/contradictions?persona= lit proposition_contradiction
--     joint à proposition (textes A et B + sources).
--   - POST /api/v2/contradictions/:id/resolve mute la ligne et applique
--     l'action sur les propositions liées (keep_a → proposition B
--     status='rejected', etc.).
--   - cron drain qui auto-merge un synonyme (lib/protocol-v2-extractor-router
--     côté findSimilarProposition) doit insérer une ligne dans
--     proposition_merge_history AVANT d'incrémenter count + append source_refs.
--   - scripts/merge-synonyms-and-list-contradictions.js doit écrire dans
--     proposition_contradiction au lieu du MD (ou en plus, le MD reste
--     output user-friendly pour Nicolas tant que l'UI n'est pas live).
--
-- Idempotence : CREATE TABLE IF NOT EXISTS partout, indexes IF NOT EXISTS.
-- Pas de DROP, pas d'ALTER sur tables existantes.

BEGIN;

-- ── 1. proposition_contradiction ─────────────────────────────────────
-- Une ligne = une paire (A, B) détectée contradictoire. Ordre A/B stable
-- (par UUID croissant) pour empêcher les doublons miroirs (A,B vs B,A).

CREATE TABLE IF NOT EXISTS proposition_contradiction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid NOT NULL REFERENCES personas(id) ON DELETE CASCADE,

  proposition_a_id uuid NOT NULL REFERENCES proposition(id) ON DELETE CASCADE,
  proposition_b_id uuid NOT NULL REFERENCES proposition(id) ON DELETE CASCADE,

  -- target_kind partagé (hard_rules / icp_patterns / process / errors /
  -- scoring / templates / identity). Si les 2 props ont des kinds
  -- différents, on n'enregistre PAS de contradiction (c'est une
  -- contradiction inter-section qui n'a pas de sens à V1).
  kind text NOT NULL CHECK (kind IN ('identity', 'icp_patterns', 'scoring',
                                     'process', 'templates', 'hard_rules',
                                     'errors', 'custom')),

  -- Score sémantique 0..1 qui a déclenché la détection. Sert à trier
  -- (les plus proches sont les contradictions les plus crédibles).
  cosine numeric(4,3) NOT NULL CHECK (cosine >= 0 AND cosine <= 1),

  -- Texte court explicatif venant du classifieur (Haiku) :
  -- "règle absolue vs conditionnelle", "seuils CA chevauchent", etc.
  reason text,

  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'punted')),

  -- Action résolutive — NULL tant que status = 'open' ou 'punted'.
  resolved_action text
    CHECK (resolved_action IN ('keep_a', 'keep_b',
                               'both_false_positive', 'reject_both')),

  resolved_note text,

  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,

  -- Invariants : A != B ; cohérence resolved_action / status / resolved_at.
  CHECK (proposition_a_id <> proposition_b_id),
  CHECK (
    (status = 'resolved' AND resolved_action IS NOT NULL AND resolved_at IS NOT NULL)
    OR
    (status IN ('open', 'punted') AND resolved_action IS NULL AND resolved_at IS NULL)
  ),

  -- Empêche d'enregistrer la même paire deux fois. Combiné avec la
  -- canonicalisation côté écriture (LEAST(a,b), GREATEST(a,b)),
  -- protège contre les doublons miroirs.
  UNIQUE (proposition_a_id, proposition_b_id)
);

-- Hot path : GET /api/v2/contradictions?persona=&status=open
CREATE INDEX IF NOT EXISTS idx_propcontra_persona_open
  ON proposition_contradiction (persona_id, detected_at DESC)
  WHERE status = 'open';

-- Lookup quand on accepte/rejette une proposition (pour invalider les
-- contradictions ouvertes qui la concernent).
CREATE INDEX IF NOT EXISTS idx_propcontra_a
  ON proposition_contradiction (proposition_a_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_propcontra_b
  ON proposition_contradiction (proposition_b_id) WHERE status = 'open';


-- ── 2. proposition_merge_history ─────────────────────────────────────
-- Snapshot d'un B mergé dans un A. Permet le split-back côté UI
-- "75 auto-mergées → vérifier".

CREATE TABLE IF NOT EXISTS proposition_merge_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid NOT NULL REFERENCES personas(id) ON DELETE CASCADE,

  -- La proposition qui a survécu au merge (status reste pending ou est
  -- déjà passée à accepted/rejected).
  kept_proposition_id uuid NOT NULL REFERENCES proposition(id) ON DELETE CASCADE,

  -- Snapshot du B au moment du merge (B.status passe à 'merged' côté
  -- proposition, mais on garde son texte ici pour reconstruction).
  merged_proposition_text text NOT NULL,
  merged_proposition_count int NOT NULL CHECK (merged_proposition_count >= 1),
  merged_provenance jsonb,
  merged_source_refs uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],

  merge_source text NOT NULL
    CHECK (merge_source IN ('auto_synonym',
                            'user_arbitrage_keep_a',
                            'user_arbitrage_keep_b')),

  -- Score qui a déclenché (auto_synonym uniquement, NULL pour user_arbitrage).
  merge_cosine numeric(4,3),

  merged_at timestamptz NOT NULL DEFAULT now(),

  -- Si l'utilisateur split-back, on remplit reverted_at. Le code de
  -- split-back ré-insère une nouvelle proposition (nouveau UUID) avec
  -- merged_proposition_text + count, et invalide cette ligne d'historique.
  reverted_at timestamptz,
  reverted_to_proposition_id uuid REFERENCES proposition(id) ON DELETE SET NULL
);

-- Hot path : list des merges actifs sur un kept_id (pour split-back).
CREATE INDEX IF NOT EXISTS idx_propmerge_kept_active
  ON proposition_merge_history (kept_proposition_id)
  WHERE reverted_at IS NULL;

-- List du panneau "Auto-mergées" sur la page brain.
CREATE INDEX IF NOT EXISTS idx_propmerge_persona_recent
  ON proposition_merge_history (persona_id, merged_at DESC)
  WHERE reverted_at IS NULL;

COMMIT;

-- ── Notes opérationnelles ──────────────────────────────────────────
-- Backfill Nicolas :
--   1. Run scripts/merge-synonyms-and-list-contradictions.js --apply
--      sur Nicolas après que le script aura été ré-écrit pour insérer
--      dans proposition_contradiction (PR ultérieur sur cette branche).
--   2. Pour le merge_history rétrospectif des auto-merges déjà faits
--      avant cette migration : pas de backfill (info perdue, on
--      l'accepte). À partir de cette migration, tout nouveau merge
--      crée une ligne d'historique.
--
-- Permissions RLS : aligné sur proposition (mêmes RLS via personas).
-- Pas de policy explicite ici : ces tables sont accédées via service_role
-- côté API, jamais côté client direct.

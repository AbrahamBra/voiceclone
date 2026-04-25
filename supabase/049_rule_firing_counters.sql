-- ============================================================
-- Migration 049 — Rule firing counters (ace pattern)
--
-- Inspiré du repo ace-agent/ace (papier arXiv:2510.04618) :
--   chaque règle (protocol_artifact) doit savoir si elle a aidé ou nui
--   aux générations passées. Un Curator job pourra ensuite proposer le
--   retrait des règles dont le ratio harmful/total devient mauvais.
--
-- Cette migration :
--   1. Crée la table protocol_rule_firing (log per-message-per-artifact)
--   2. Étend les defaults du stats jsonb sur protocol_artifact pour
--      inclure helpful_count / harmful_count / fires_total
--   3. Backfill cohérent du stats jsonb existant
--
-- Additif uniquement — aucun DROP, aucun ALTER destructif.
-- Prérequis : 048 appliquée (PR #122). À appliquer manuellement via
-- Supabase SQL Editor, comme les autres migrations protocol-v2.
-- ============================================================

-- ── 1. protocol_rule_firing ──────────────────────────────────
--
-- Une row par (artifact, message). À l'insertion, outcome='pending'.
-- Quand le user résout le message (accept/copy/correct), bulk-update
-- toutes les rows pending pour ce message en helpful/harmful selon le
-- signal.
--
-- Pas de FK strictes vers messages/conversations pour découpler de leur
-- schéma (qui pourrait être migré indépendamment) : on stocke des uuid
-- plats et l'application gère la cohérence.

CREATE TABLE IF NOT EXISTS protocol_rule_firing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  artifact_id uuid NOT NULL
    REFERENCES protocol_artifact(id) ON DELETE CASCADE,

  message_id uuid,
  conversation_id uuid,
  persona_id uuid,

  fired_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending', 'helpful', 'harmful', 'unrelated')),
  resolved_at timestamptz
);

COMMENT ON TABLE protocol_rule_firing IS
  'Log per-message-per-artifact. outcome=pending à la création, résolu en helpful/harmful/unrelated quand le user agit sur le message.';

CREATE INDEX IF NOT EXISTS idx_protocol_rule_firing_artifact
  ON protocol_rule_firing (artifact_id, outcome);

-- Partial index : le Curator query WHERE outcome='pending' AND fired_at < now()-interval.
CREATE INDEX IF NOT EXISTS idx_protocol_rule_firing_pending
  ON protocol_rule_firing (fired_at)
  WHERE outcome = 'pending';

-- Lookup par message_id pour le bulk-resolve.
CREATE INDEX IF NOT EXISTS idx_protocol_rule_firing_message
  ON protocol_rule_firing (message_id)
  WHERE message_id IS NOT NULL;

-- ── 2. Étendre stats jsonb default sur protocol_artifact ──────
--
-- Le DEFAULT actuel est '{"fires":0,"last_fired_at":null,"accuracy":null}'.
-- On garde fires (rétro-compat) et on ajoute :
--   - fires_total      : alias plus explicite pour le Curator
--   - helpful_count    : nb de firings résolus en helpful
--   - harmful_count    : nb de firings résolus en harmful
--
-- Pas d'ALTER COLUMN SET DEFAULT (Postgres ne supporte pas le merge de
-- jsonb defaults proprement) — on backfill les rows existantes ci-dessous,
-- et on documente la nouvelle shape pour les inserts futurs.

UPDATE protocol_artifact
SET stats = stats
  || jsonb_build_object(
       'fires_total', COALESCE((stats->>'fires')::int, 0),
       'helpful_count', 0,
       'harmful_count', 0
     )
WHERE NOT (stats ? 'fires_total');

COMMENT ON COLUMN protocol_artifact.stats IS
  'Shape: {fires:int, fires_total:int, last_fired_at:ts, accuracy:float|null, helpful_count:int, harmful_count:int}. helpful_count/harmful_count incrémentés par lib/protocol-v2-rule-counters.js sur résolution des firings.';

-- ── 3. RLS ────────────────────────────────────────────────────
ALTER TABLE protocol_rule_firing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON protocol_rule_firing;
CREATE POLICY service_role_all ON protocol_rule_firing
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Migration 035 — Stage auto-dérivé depuis les signaux de conversation
--
-- Contexte : migration 030 a ajouté `conversations.stage text` (freeform).
-- En pratique l'opérateur ne remplit jamais ce champ manuellement → vide.
-- On bascule sur un pipeline auto-dérivé depuis turn_kind + scenario_type :
--
--   stage slug         déclencheur
--   ───────────────────────────────────────────────────────────────────
--   to_contact         conv créée, 0 message toi / 0 prospect
--   first_message      ≥1 message toi, 0 prospect
--   in_conv            ≥1 prospect (prospect a répondu)
--   follow_up          scenario_type = DM_relance + ≥1 prospect
--   closing            scenario_type = DM_closing
--
-- Override manuel : si l'opérateur édite le champ stage via l'UI, on flip
-- stage_auto=false → l'auto-dérivation ne touche plus. Un bouton "↻ auto"
-- côté UI le remet à true.
--
-- Scope additif : pas de DROP. Garde stage text (slug OU texte libre custom).
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS stage_auto boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN conversations.stage_auto IS
  'true = stage dérivé auto depuis signaux (turn_kind/scenario_type). false = override manuel opérateur.';

-- Les conversations avec un stage texte libre existant sont considérées
-- comme manuellement éditées — on préserve ce qu'a écrit l'user.
UPDATE conversations SET stage_auto = false WHERE stage IS NOT NULL;

-- Backfill des stages auto sur les conv existantes (stage NULL) :
-- - pas de message toi/prospect → to_contact
-- - ≥1 prospect → in_conv (domine first_message)
-- - ≥1 toi, 0 prospect → first_message
-- scenario_type DM_closing/DM_relance écrase ensuite.
-- Note : on skip follow_up au backfill (demande un ordre temporel compliqué ;
-- le prochain event déclenchera la recompute correcte).
WITH stats AS (
  SELECT
    c.id,
    bool_or(m.turn_kind = 'toi') AS has_toi,
    bool_or(m.turn_kind = 'prospect') AS has_prospect
  FROM conversations c
  LEFT JOIN messages m
    ON m.conversation_id = c.id AND m.message_type = 'chat'
  WHERE c.stage IS NULL
  GROUP BY c.id
)
UPDATE conversations c
SET stage = CASE
  WHEN c.scenario_type = 'DM_closing'           THEN 'closing'
  WHEN s.has_prospect                           THEN 'in_conv'
  WHEN s.has_toi                                THEN 'first_message'
  ELSE                                               'to_contact'
END
FROM stats s
WHERE c.id = s.id AND c.stage IS NULL AND c.stage_auto = true;

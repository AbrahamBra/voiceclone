-- 069_corrections_source_channel_default.sql
--
-- Bug fix : drain feedback-event-to-proposition.js filtre les corrections
-- via `.in("source_channel", ELIGIBLE_CORRECTION_CHANNELS)`. La liste contient
-- 'explicit_button' avec un commentaire "the live DB default for ... validate /
-- client_validate / excellent / corrected / save_rule" — mais en prod cette
-- valeur N'EST JAMAIS settée par api/feedback.js sur ces 9 inserts. Résultat :
-- ~12 sites d'INSERT corrections sur 14 ressortent NULL et la clause `.in(...)`
-- exclut NULL → corrections jamais drainées vers proposition.
--
-- Fix en 2 temps :
--   1. SET DEFAULT 'explicit_button' sur source_channel pour que tout futur
--      INSERT qui ne setait pas la colonne (validate, client_validate, etc.)
--      tombe dans la liste éligible.
--   2. UPDATE backfill : marquer toutes les rows historiques NULL comme
--      'explicit_button' pour qu'elles soient drainées au prochain cron run.
--
-- Cohérence : la valeur 'explicit_button' est celle référencée par le drain
-- (scripts/feedback-event-to-proposition.js:166-178). On aligne l'écriture
-- DB avec la lecture côté code.
--
-- Référence audit : docs/audits/protocol-underutilization-2026-05-01.md §5
-- (le canal feedback fuit, cause #1 de la sous-utilisation perçue) +
-- session 2026-05-02 chantier 3.
--
-- Idempotent : le DEFAULT et le backfill peuvent être re-exécutés sans
-- effet de bord (DEFAULT idempotent par construction, UPDATE filtré sur NULL).

ALTER TABLE corrections
  ALTER COLUMN source_channel SET DEFAULT 'explicit_button';

UPDATE corrections
SET source_channel = 'explicit_button'
WHERE source_channel IS NULL;

-- Mise à jour du commentaire pour refléter la nouvelle valeur par défaut.
COMMENT ON COLUMN corrections.source_channel IS
  'Origin of the signal. Default ''explicit_button'' (mig 069). Other known values: copy_paste_out, regen_rejection, edit_diff, chat_correction, client_validated, negative_feedback, direct_instruction, coaching_correction, metacognitive_n3, proactive_n4. NULL backfilled to explicit_button by mig 069.';

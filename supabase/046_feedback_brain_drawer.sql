-- 046_feedback_brain_drawer.sql
--
-- Chantier #2 (drawer cerveau latéral) — ajoute deux event_types au pipeline
-- feedback :
--   • brain_drawer_opened       — user ouvre le drawer cerveau depuis le chat
--                                  (source: top_button | cmd_k | url_redirect)
--   • brain_edit_during_draft   — user ajoute/corrige une règle dans le drawer
--                                  pendant qu'un draft est actif dans le composer
--                                  (signal du moment data-move, cible prioritaire)
--
-- Attaché au dernier message narratif (`toi`/`prospect`/`clone_draft`/`draft_rejected`)
-- de la conv courante pour préserver l'invariant `message_id NOT NULL`. Si la conv
-- n'a aucun message narratif, le client skip l'émission silencieusement (cf.
-- §"Cas limites" du spec). Pas de relaxation DB.
--
-- Spec source : docs/superpowers/specs/2026-04-24-brain-drawer-lateral-design.md.
-- Numéros 038/039 = protocole-v2 core/hooks (PR #79). 040 = training signal capture.
-- 041-043 réservés paper-space pour les follow-ups Chunk 2.5 protocole-vivant
-- (rule_proposals, n4_paused_until, promoted_to_rule_index). 044-045 déjà
-- appliqués (dernier = 045 match_propositions vector(1024)). D'où 046.
-- Additif uniquement — aucun DROP destructif.

ALTER TABLE feedback_events
  DROP CONSTRAINT IF EXISTS feedback_events_event_type_check;

ALTER TABLE feedback_events
  ADD CONSTRAINT feedback_events_event_type_check
  CHECK (event_type IN (
    'validated',
    'validated_edited',
    'corrected',
    'saved_rule',
    'excellent',
    'client_validated',
    'paste_zone_dismissed',
    'copy_paste_out',
    'regen_rejection',
    'brain_drawer_opened',
    'brain_edit_during_draft'
  ));

COMMENT ON COLUMN feedback_events.event_type IS
  'Feedback taxonomy. 11 event types: validated, validated_edited, corrected, saved_rule, excellent, client_validated, paste_zone_dismissed, copy_paste_out, regen_rejection, brain_drawer_opened, brain_edit_during_draft. See 046_feedback_brain_drawer.sql.';

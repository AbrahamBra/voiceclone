-- 072_appointment_booked_event_type.sql
--
-- Étend feedback_events.event_type pour tracker les RDV pris par les setters.
-- Utilisé par GET /api/v2/clone-outcomes (cockpit V2) pour afficher le
-- compteur "RDV pris cette semaine" en hero outcome de la zone construction.
--
-- Le setter marquera "RDV pris" depuis /chat/[persona] (UI à ajouter dans
-- une issue parallèle, hors scope cockpit V2).
--
-- Liste de base : 9 event_types existants (mig 040). On ajoute le 10ème.
-- Idempotent : DROP IF EXISTS + ADD CONSTRAINT.

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
    'appointment_booked'
  ));

COMMENT ON CONSTRAINT feedback_events_event_type_check ON feedback_events IS
  'Type d''événement feedback. 10 types (9 de mig 040 + appointment_booked '
  'de mig 072). appointment_booked = RDV pris marqué manuellement par le '
  'setter depuis /chat/[persona], consommé par /api/v2/clone-outcomes.';

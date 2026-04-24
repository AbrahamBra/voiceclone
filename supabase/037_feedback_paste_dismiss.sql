-- 037_feedback_paste_dismiss.sql
-- Ajoute 'paste_zone_dismissed' aux event_types autorisés pour feedback_events.
-- Émis quand l'opérateur dismiss la zone paste "réponse prospect" dans le
-- composer chat. Signal que la conv n'attend plus de réponse (ou que
-- l'opérateur ignore ce prospect pour l'instant). Attaché au dernier message
-- 'toi' de la conv. Suit la séquence 029 → 031 ('excellent') → 032
-- ('client_validated') qui ont déjà étendu ce CHECK (033–036 sont des
-- migrations non-feedback : demo_persona, extraction_status, stage_auto,
-- operating_protocols).

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
    'paste_zone_dismissed'
  ));

COMMENT ON COLUMN feedback_events.event_type IS
  'Feedback taxonomy. 7 event types: validated, validated_edited, corrected, saved_rule, excellent, client_validated, paste_zone_dismissed. See 037_feedback_paste_dismiss.sql.';

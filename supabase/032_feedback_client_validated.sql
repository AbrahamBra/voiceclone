-- 032_feedback_client_validated.sql
-- Ajoute 'client_validated' à feedback_events.event_type en plus de 'excellent'
-- (ajouté en 031). 'client_validated' = approbation client explicite (signal
-- d'apprentissage fort, +0.12 entity boost). 'excellent' = pattern à multiplier.
-- Superset : garde les 6 event_types pour couvrir tous les chemins UI.
-- Voir spec 2026-04-20-chat-client-validation.md.

ALTER TABLE feedback_events
  DROP CONSTRAINT IF EXISTS feedback_events_event_type_check;

ALTER TABLE feedback_events
  ADD CONSTRAINT feedback_events_event_type_check
  CHECK (event_type IN ('validated','validated_edited','corrected','saved_rule','excellent','client_validated'));

COMMENT ON COLUMN feedback_events.event_type IS
  'Feedback taxonomy. client_validated = explicit external approval (stronger signal, +0.12 boost). excellent = pattern à multiplier. Voir 032_feedback_client_validated.sql.';

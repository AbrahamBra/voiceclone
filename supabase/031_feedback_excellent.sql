-- 031_feedback_excellent.sql
-- Ajoute 'excellent' aux event_type valides pour feedback_events.
-- Splitter 'validated' (c'est ça) vs 'excellent' (★ parfait) donne un signal
-- d'apprentissage plus riche : "passable" ≠ "pattern à multiplier".

ALTER TABLE feedback_events DROP CONSTRAINT IF EXISTS feedback_events_event_type_check;

ALTER TABLE feedback_events
  ADD CONSTRAINT feedback_events_event_type_check
  CHECK (event_type IN ('validated','validated_edited','corrected','saved_rule','excellent'));

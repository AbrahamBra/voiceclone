-- 031_feedback_client_validated.sql
-- Add 'client_validated' to feedback_events.event_type. Distinct from
-- 'validated' (passive: operator sent as-is) — this one means the agency-
-- client explicitly confirmed the clone captured their voice/intent.
-- Carries stronger learning weight. See spec 2026-04-20-chat-client-validation.

ALTER TABLE feedback_events
  DROP CONSTRAINT IF EXISTS feedback_events_event_type_check;

ALTER TABLE feedback_events
  ADD CONSTRAINT feedback_events_event_type_check
  CHECK (event_type IN ('validated','validated_edited','corrected','saved_rule','client_validated'));

COMMENT ON COLUMN feedback_events.event_type IS
  'Feedback taxonomy. client_validated = explicit external approval (stronger signal). See 031_feedback_client_validated.sql.';

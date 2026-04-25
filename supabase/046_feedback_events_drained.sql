-- 046_feedback_events_drained.sql
--
-- Chunk 2 Task 2.7 — adds idempotency column to feedback_events so the
-- protocole-vivant cron (scripts/feedback-event-to-proposition.js) doesn't
-- re-process the same event on every tick.
--
-- Numéros 041-043 réservés paper-space aux follow-ups Chunk 2.5.
-- 044 supersédée par 045. Cette migration prend 046.
-- ============================================================

ALTER TABLE feedback_events
  ADD COLUMN IF NOT EXISTS drained_at timestamptz;

COMMENT ON COLUMN feedback_events.drained_at IS
  'Set when the event has been processed by the protocole-vivant cron (feedback-event-to-proposition). NULL = not yet drained.';

-- Partial index : the cron only ever queries WHERE drained_at IS NULL ORDER BY created_at.
-- Partial index on this filter keeps the lookup O(log undrained_count) regardless of
-- total event volume.
CREATE INDEX IF NOT EXISTS idx_feedback_events_undrained
  ON feedback_events (created_at)
  WHERE drained_at IS NULL;

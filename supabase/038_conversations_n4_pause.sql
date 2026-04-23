-- 038_conversations_n4_pause.sql
-- Anti-fatigue: pause proactive N4 chip proposals per-conversation
-- after 3 consecutive rejections.
-- Idempotent.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS n4_paused_until TIMESTAMPTZ;

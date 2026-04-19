-- 029_feedback_events.sql
-- Conversation-scoped feedback journal. Distinct from learning_events (persona-
-- scoped, payload-typed). Populates the FeedbackRail (zone B) of the new
-- /chat/[persona] layout. See spec 2026-04-19-chat-dossier-prospect-2-zones.

CREATE TABLE IF NOT EXISTS feedback_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  persona_id uuid NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('validated','validated_edited','corrected','saved_rule')),
  correction_text text,
  diff_before text,
  diff_after text,
  rules_fired jsonb NOT NULL DEFAULT '[]'::jsonb,
  learning_event_id uuid REFERENCES learning_events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_events_conv_created
  ON feedback_events(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_events_persona_created
  ON feedback_events(persona_id, created_at DESC);

COMMENT ON TABLE feedback_events IS
  'Conversation-scoped feedback journal. Populates the FeedbackRail in /chat/[persona].';

-- RLS: follow the 019_rls_baseline pattern — service_role bypasses, explicit
-- policy for documentation. Anon/authenticated see nothing by default.
ALTER TABLE feedback_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON feedback_events;
CREATE POLICY service_role_all ON feedback_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

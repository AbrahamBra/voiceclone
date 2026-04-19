-- 028_turn_kind.sql
-- Narrative-role axis for messages, orthogonal to role (user/assistant) and
-- message_type (chat/meta from 027). Resolves the historical overload where
-- role='user' designated BOTH operator prompts AND prospect DMs.
--
-- turn_kind values:
--   prospect        — inbound prospect DM (paste ou auto-import Breakcold)
--   clone_draft     — assistant output not yet validated by operator
--   toi             — assistant output validated (= sent to the prospect)
--   draft_rejected  — clone_draft replaced after correction (soft-delete, kept for audit)
--   legacy          — pre-migration rows; ChatMessage renders via compat path
--   meta            — mirror of message_type='meta' for filter symmetry

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS turn_kind text NOT NULL DEFAULT 'legacy'
  CHECK (turn_kind IN ('prospect','clone_draft','toi','draft_rejected','legacy','meta'));

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS draft_of_message_id uuid REFERENCES messages(id);

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS edited_before_send boolean NOT NULL DEFAULT false;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS draft_original text;

COMMENT ON COLUMN messages.turn_kind IS
  'Narrative role axis. Orthogonal to role and message_type (027). See spec 2026-04-19-chat-dossier-prospect-2-zones-design.';

-- Align turn_kind for meta messages so the index on turn_kind returns them too
-- without needing a separate check on message_type.
UPDATE messages SET turn_kind = 'meta' WHERE message_type = 'meta' AND turn_kind = 'legacy';

-- Index supports the very common "last active clone_draft per conversation"
-- lookup that the front will run on every conversation load.
CREATE INDEX IF NOT EXISTS idx_messages_conv_turn_kind
  ON messages(conversation_id, turn_kind, created_at);

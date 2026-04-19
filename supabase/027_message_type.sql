-- 027_message_type.sql
-- Flag `messages.message_type` to separate prospect↔clone DM simulation
-- ("chat") from system confirmations inserted by api/chat.js shortcuts
-- ("meta": "Règle ajoutée", "Règle affaiblie", "APPRENTISSAGE ENREGISTRE").
--
-- Motivation: the chat thread is meant to be copied-pasted quasi as-is to
-- LinkedIn DM. Shortcut confirmations pollute that WYSIWYG contract. Front
-- filters type='chat' in the main thread view; a side pane reads meta for
-- the "journal d'apprentissage".

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'chat'
  CHECK (message_type IN ('chat', 'meta'));

COMMENT ON COLUMN messages.message_type IS
  'chat: prospect↔clone DM simulation (default). meta: shortcut confirmation (rule added/weakened). Main thread view filters type=chat.';

-- Backfill: classify existing assistant messages that match known shortcut
-- confirmation templates. Best-effort heuristic — covers the templates
-- produced by api/chat.js NEGATIVE (lines 192-194) and INSTRUCTION (lines
-- 233-235) shortcuts, plus the "APPRENTISSAGE ENREGISTRE" variants observed
-- in production for persona thomas-abdelhay.
UPDATE messages
SET message_type = 'meta'
WHERE role = 'assistant'
  AND (
    content LIKE 'Règle affaiblie%'
    OR content LIKE 'Règle ajoutée%'
    OR content LIKE '% règles affaiblies%'
    OR content LIKE '% règles ajoutées%'
    OR content LIKE 'APPRENTISSAGE ENREGISTRE%'
  );

-- The user message that triggered a NEGATIVE/INSTRUCTION shortcut is also
-- meta (it's an operator→clone instruction, not a prospect DM). We classify
-- the user message paired with each meta-assistant reply. Pair = same
-- conversation_id, user role, created within 3s BEFORE the meta reply.
UPDATE messages m_user
SET message_type = 'meta'
FROM messages m_bot
WHERE m_bot.message_type = 'meta'
  AND m_bot.role = 'assistant'
  AND m_user.role = 'user'
  AND m_user.conversation_id = m_bot.conversation_id
  AND m_user.created_at < m_bot.created_at
  AND m_user.created_at > m_bot.created_at - INTERVAL '3 seconds'
  AND m_user.message_type = 'chat';

-- Composite index supports the common filter `conversation_id + message_type`
-- with ordering on created_at — used on every conversation load.
CREATE INDEX IF NOT EXISTS idx_messages_conv_type_created
  ON messages(conversation_id, message_type, created_at);

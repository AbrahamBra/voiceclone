-- 004_conversations.sql
-- Persistent conversation storage

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  persona_id uuid REFERENCES personas(id) ON DELETE CASCADE NOT NULL,
  scenario text NOT NULL DEFAULT 'default',
  title text,
  last_message_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_client_persona ON conversations(client_id, persona_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_messages_content_trgm ON messages USING gin(content gin_trgm_ops);

-- RPC for counting messages per conversation (avoids N+1)
CREATE OR REPLACE FUNCTION count_messages_by_conversation(conv_ids uuid[])
RETURNS TABLE (conversation_id uuid, count bigint)
LANGUAGE SQL STABLE
AS $$
  SELECT m.conversation_id, COUNT(*)
  FROM messages m
  WHERE m.conversation_id = ANY(conv_ids)
  GROUP BY m.conversation_id;
$$;

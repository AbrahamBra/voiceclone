-- 021_prospect_heat.sql
-- Per-message heat score capturing prospect engagement over a conversation.
-- Computed auto on every inbound prospect message (role='user' in messages table,
-- when the conversation is a real LinkedIn thread — see lib/heat/prospectHeat.js).
-- Used to validate RhythmCritic: flagged drafts should correlate with subsequent heat drops.

CREATE TABLE IF NOT EXISTS prospect_heat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  message_id uuid REFERENCES messages(id) ON DELETE CASCADE NOT NULL,
  -- heat in [0, 1]: 0 = prospect froid/absent, 1 = chaud, réactif, engagé
  heat numeric(4,3) NOT NULL CHECK (heat >= 0 AND heat <= 1),
  -- signals: { len_norm, question_ratio, recency_score, lexical_score, trend }
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- delta vs previous message in same conversation (null for first)
  delta numeric(5,3),
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prospect_heat_conv_created
  ON prospect_heat(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_prospect_heat_message
  ON prospect_heat(message_id);
-- Useful for dashboards: hot conversations in the last N days
CREATE INDEX IF NOT EXISTS idx_prospect_heat_hot
  ON prospect_heat(conversation_id, created_at DESC)
  WHERE heat >= 0.7;

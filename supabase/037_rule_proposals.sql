-- 037_rule_proposals.sql
-- N3 offline full-conv rescan output: rule proposals pending N4 validation.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS rule_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  rule_text TEXT NOT NULL,
  evidence_message_ids UUID[] NOT NULL,
  pattern_type TEXT NOT NULL,
  confidence NUMERIC(3,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by_event_id UUID,
  CHECK (pattern_type IN ('style_drift','repeated_rejection','silent_constraint','contradiction')),
  CHECK (status IN ('pending','accepted','rejected','superseded')),
  CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS idx_rule_proposals_persona_status
  ON rule_proposals(persona_id, status);

CREATE INDEX IF NOT EXISTS idx_rule_proposals_pending
  ON rule_proposals(persona_id, proposed_at DESC)
  WHERE status = 'pending';

-- Rescan cursor: skip conversations already analyzed since last activity.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_rescan_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_rescan_candidates
  ON conversations(last_message_at DESC)
  WHERE last_rescan_at IS NULL OR last_rescan_at < last_message_at;

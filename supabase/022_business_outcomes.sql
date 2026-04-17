-- 022_business_outcomes.sql
-- User-declared business outcomes: "this message triggered the RDV", "RDV signed".
-- The ground truth against which RhythmCritic (and other critics) are validated.

CREATE TABLE IF NOT EXISTS business_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  -- message_id nullable: 'rdv_signed' is conversation-level, not message-level
  message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  persona_id uuid REFERENCES personas(id) ON DELETE CASCADE NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  -- outcome values:
  --   'rdv_triggered'  a specific assistant message is credited by the user as what made the prospect accept the RDV
  --   'rdv_signed'     the deal/appointment is confirmed (conversation-level)
  --   'rdv_no_show'    RDV was taken but prospect did not show
  --   'rdv_lost'       deal lost after RDV
  outcome text NOT NULL CHECK (outcome IN ('rdv_triggered', 'rdv_signed', 'rdv_no_show', 'rdv_lost')),
  -- optional deal value (currency-agnostic numeric)
  value numeric(12,2),
  note text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_business_outcomes_persona
  ON business_outcomes(persona_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_outcomes_conv
  ON business_outcomes(conversation_id);
CREATE INDEX IF NOT EXISTS idx_business_outcomes_message
  ON business_outcomes(message_id) WHERE message_id IS NOT NULL;

-- One 'rdv_signed' per conversation max (idempotent on user clicks).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_rdv_signed_per_conv
  ON business_outcomes(conversation_id)
  WHERE outcome = 'rdv_signed';

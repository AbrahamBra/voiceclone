-- 020_rhythm_shadow.sql
-- Shadow-mode log of RhythmCritic evaluations.
-- Every generated draft is scored and logged here BEFORE stream, without gating anything.
-- Promoted to guard mode only after precision/recall thresholds validated.

CREATE TABLE IF NOT EXISTS rhythm_shadow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid REFERENCES personas(id) ON DELETE CASCADE NOT NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  draft text NOT NULL,
  score numeric(5,4) NOT NULL,
  -- signals: { A1: 0|1, A2: 0|1, ..., signalA_cosine: 0.78, ... }
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- reasons: human-readable tags, ex: ["phrase_too_long", "no_punch"]
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  would_flag boolean NOT NULL DEFAULT false,
  threshold_used numeric(5,4),
  critic_version text NOT NULL DEFAULT 'v1-shadow',
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rhythm_shadow_persona_created
  ON rhythm_shadow(persona_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rhythm_shadow_conv
  ON rhythm_shadow(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rhythm_shadow_flag
  ON rhythm_shadow(persona_id, would_flag, created_at DESC)
  WHERE would_flag = true;

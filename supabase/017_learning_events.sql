-- Learning Feed: chronological trace of what the clone learned / unlearned.
-- Written server-side after each feedback detection or consolidation run.
-- Read by the UI (IntelligencePanel > LearningFeed) to show "what just changed".

CREATE TABLE IF NOT EXISTS learning_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  persona_id uuid REFERENCES personas(id) ON DELETE CASCADE NOT NULL,
  -- event_type values:
  --   'rule_added'            direct instruction saved a new writingRule
  --   'rule_weakened'         negative feedback demoted existing rules
  --   'correction_saved'      coaching/chat feedback captured a correction
  --   'consolidation_run'     cluster of corrections synthesized into a rule
  --   'consolidation_reverted' backtest triggered auto-revert (fidelity dropped)
  event_type text NOT NULL,
  -- Flexible payload per event type. Expected keys by type:
  --   rule_added:            { rules: [string], count: int }
  --   rule_weakened:         { corrections: [string], demoted: int }
  --   correction_saved:      { source: 'coaching'|'chat', count: int, text: string }
  --   consolidation_run:     { promoted: int, cluster_sizes: [int], revert: bool }
  --   consolidation_reverted:{ reason: string, delta_score: int, delta_collapse: int }
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Optional fidelity snapshots (populated mainly by consolidation events)
  fidelity_before integer,
  fidelity_after integer,
  collapse_before integer,
  collapse_after integer,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_learning_events_persona_created
  ON learning_events(persona_id, created_at DESC);

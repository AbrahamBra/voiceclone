-- Daily aggregated metrics per persona for observability
CREATE TABLE IF NOT EXISTS persona_metrics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Chat metrics
  total_messages INT DEFAULT 0,
  total_input_tokens INT DEFAULT 0,
  total_output_tokens INT DEFAULT 0,
  cache_read_tokens INT DEFAULT 0,
  cache_creation_tokens INT DEFAULT 0,
  avg_latency_ms INT DEFAULT 0,

  -- Quality metrics
  rewrite_count INT DEFAULT 0,
  rewrite_rate REAL DEFAULT 0,          -- rewrite_count / total_messages
  hard_violations INT DEFAULT 0,
  strong_violations INT DEFAULT 0,

  -- Model routing
  haiku_messages INT DEFAULT 0,
  sonnet_messages INT DEFAULT 0,

  -- Learning metrics
  corrections_added INT DEFAULT 0,
  corrections_graduated INT DEFAULT 0,
  corrections_archived INT DEFAULT 0,
  feedback_false_positives INT DEFAULT 0, -- corrections demoted within 7 days

  -- Knowledge metrics
  entities_count INT DEFAULT 0,
  relations_count INT DEFAULT 0,

  -- Eval score (null if no eval run that day)
  eval_score REAL,
  eval_total INT,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(persona_id, date)
);

CREATE INDEX idx_metrics_persona_date ON persona_metrics_daily(persona_id, date DESC);

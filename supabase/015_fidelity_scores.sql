CREATE TABLE IF NOT EXISTS fidelity_scores (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  persona_id uuid REFERENCES personas(id) ON DELETE CASCADE NOT NULL,
  score_global integer NOT NULL,
  score_raw float NOT NULL,
  scores_by_theme jsonb NOT NULL,
  theme_count integer NOT NULL,
  chunk_count integer NOT NULL,
  low_confidence boolean DEFAULT false,
  calculated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fidelity_persona
  ON fidelity_scores(persona_id, calculated_at DESC);

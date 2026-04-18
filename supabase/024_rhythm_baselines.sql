-- 024_rhythm_baselines.sql
-- Baseline distributionnel par persona, calculé sur le corpus gold (messages.is_gold = true).
-- Une ligne par persona. Recalculé périodiquement (nightly cron ou manuel).
--
-- v1 : diagonal only (z-score par dim) — robuste avec N petit (~25 samples, 8 dims).
-- v2 : full covariance avec shrinkage quand N ≥ 50 samples.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS rhythm_baselines (
  persona_id uuid PRIMARY KEY REFERENCES personas(id) ON DELETE CASCADE,
  -- { "rm_len_mean": 12.3, "rm_len_std": 5.2, ... } par dimension
  mean jsonb NOT NULL,
  std jsonb NOT NULL,
  -- Nombre de samples gold utilisés
  sample_count int NOT NULL,
  -- Version du module de calcul (permet invalidation si on change les dims)
  baseline_version text NOT NULL DEFAULT 'v1-diagonal',
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE rhythm_baselines ENABLE ROW LEVEL SECURITY;

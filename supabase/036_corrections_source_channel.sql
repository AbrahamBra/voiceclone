-- 036_corrections_source_channel.sql
-- Enriches corrections table with signal channel + confidence weighting
-- for multi-channel training signal capture (N1-N4).
-- Idempotent: safe to re-run.

ALTER TABLE corrections
  ADD COLUMN IF NOT EXISTS source_channel    TEXT         NOT NULL DEFAULT 'explicit_button',
  ADD COLUMN IF NOT EXISTS confidence_weight NUMERIC(3,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS is_implicit       BOOLEAN      NOT NULL DEFAULT false;

ALTER TABLE corrections
  DROP CONSTRAINT IF EXISTS corrections_source_channel_check;

ALTER TABLE corrections
  ADD CONSTRAINT corrections_source_channel_check
  CHECK (source_channel IN (
    'explicit_button',      -- ✓ c'est ça, ★ excellent, ✎ corriger, 📏 save rule
    'client_validated',     -- 🟢 bouton validation client agence
    'edit_diff',            -- user a édité avant d'envoyer (diff sent vs proposed)
    'copy_paste_out',       -- copié le draft (signal positif fort)
    'regen_rejection',      -- a cliqué ↻ regen (signal négatif implicite)
    'chat_correction',      -- correction inline détectée dans message user
    'negative_feedback',    -- "non", "pas comme ça" détecté
    'direct_instruction',   -- "tu dois toujours...", "ne fais jamais..."
    'coaching_correction',  -- reformulation didactique détectée
    'metacognitive_n3',     -- IA a relu la conv offline et proposé une règle
    'proactive_n4'          -- IA a demandé validation à l'utilisateur
  ));

CREATE INDEX IF NOT EXISTS idx_corrections_channel ON corrections(source_channel);
CREATE INDEX IF NOT EXISTS idx_corrections_weight  ON corrections(confidence_weight DESC);

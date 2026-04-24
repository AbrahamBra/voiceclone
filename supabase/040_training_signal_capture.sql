-- 040_training_signal_capture.sql
--
-- Chunk 2.5 "Training signal capture" — prequel au plan protocole-vivant.
-- Ajoute deux signaux implicites au pipeline feedback :
--   • copy_paste_out   — user copie un draft vers l'extérieur (LinkedIn, etc.)
--                        = positif implicite, weight 0.6
--   • regen_rejection  — user clique ↻ regen sur un draft
--                        = négatif implicite, weight 0.5
--
-- Ces signaux alimenteront le cron feedback-event-to-proposition de chunk 2
-- du plan protocole-vivant (docs/superpowers/plans/2026-04-24-protocole-vivant-plan.md).
--
-- Spec source : docs/superpowers/specs/2026-04-23-training-signal-capture-design.md
-- (archivé depuis PR #50 fermée pour collision de migrations).
--
-- Cohabite avec 038/039 réservés par le plan protocole-vivant.
-- Additif uniquement — aucun DROP, aucun ALTER destructif.

-- ── 1. Widen feedback_events.event_type check ──────────────────────────
ALTER TABLE feedback_events
  DROP CONSTRAINT IF EXISTS feedback_events_event_type_check;

ALTER TABLE feedback_events
  ADD CONSTRAINT feedback_events_event_type_check
  CHECK (event_type IN (
    'validated',
    'validated_edited',
    'corrected',
    'saved_rule',
    'excellent',
    'client_validated',
    'paste_zone_dismissed',
    'copy_paste_out',
    'regen_rejection'
  ));

COMMENT ON COLUMN feedback_events.event_type IS
  'Feedback taxonomy. 9 event types: validated, validated_edited, corrected, saved_rule, excellent, client_validated, paste_zone_dismissed, copy_paste_out, regen_rejection. See 040_training_signal_capture.sql.';

-- ── 2. Enrich corrections with signal-capture columns ──────────────────
-- Idempotent (IF NOT EXISTS) — safe to re-run and safe if columns were
-- applied manually earlier (per closed PR #50's body).

ALTER TABLE corrections ADD COLUMN IF NOT EXISTS source_channel text;
ALTER TABLE corrections ADD COLUMN IF NOT EXISTS confidence_weight numeric(3,2);
ALTER TABLE corrections ADD COLUMN IF NOT EXISTS is_implicit boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN corrections.source_channel IS
  'Origin of the signal. Known values: copy_paste_out, regen_rejection, explicit (null = pre-040 legacy).';
COMMENT ON COLUMN corrections.confidence_weight IS
  'Structural reliability of the signal at insertion. Orthogonal to confidence (which decays). 1.0=explicit, 0.6=copy_paste, 0.5=regen_rejection.';
COMMENT ON COLUMN corrections.is_implicit IS
  'True when user did not articulate a correction explicitly (copy, regen, etc.).';

CREATE INDEX IF NOT EXISTS idx_corrections_source_channel
  ON corrections (source_channel)
  WHERE source_channel IS NOT NULL;

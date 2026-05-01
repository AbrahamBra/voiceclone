-- 057_protocol_v2_drain_atomic_claim.sql
--
-- Cron-protocol-v2-drain idempotency hardening.
--
-- Problem: cron-protocol-v2-drain runs every 5 min with a 30-min lookback.
-- If Vercel re-fires the cron < 5 min after a previous run (retry, manual
-- trigger, two regions briefly overlapping), both runs query the same set
-- of `drained_at IS NULL` rows. The first to commit `drained_at = now()`
-- wins, but the slower run has already routed → extracted → embedded the
-- same signal, producing a duplicate proposition that won't dedup against
-- itself (different embedding vectors, same source).
--
-- Fix: a two-phase claim/drain protocol.
--   1. Claim phase: atomic UPDATE ... FOR UPDATE SKIP LOCKED grabs N rows,
--      stamps them with claimed_at + claim_token, returns the locked set.
--      A concurrent run sees the rows already locked → skips them.
--   2. Drain phase: existing per-row `drained_at = now()` write at the end
--      of processing, unchanged.
--
-- Crash recovery: a claim older than 5 min with drained_at still null
-- means a previous run died mid-flight. Such rows become eligible for
-- re-claim, so the signal isn't permanently stuck.
-- ============================================================

ALTER TABLE feedback_events
  ADD COLUMN IF NOT EXISTS claimed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS claim_token uuid;

COMMENT ON COLUMN feedback_events.claimed_at IS
  'Set by claim_undrained_feedback_events when a cron run takes ownership of the row. Used together with claim_token to detect stale claims (>5 min).';

COMMENT ON COLUMN feedback_events.claim_token IS
  'Per-cron-run uuid stamped at claim time. Lets a run identify rows it owns vs rows abandoned by a crashed prior run.';

ALTER TABLE corrections
  ADD COLUMN IF NOT EXISTS proposition_claimed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS proposition_claim_token uuid;

COMMENT ON COLUMN corrections.proposition_claimed_at IS
  'Set by claim_undrained_corrections when a cron run takes ownership of the row for the proposition bridge. Distinct from the consolidation rule-promotion flow.';

COMMENT ON COLUMN corrections.proposition_claim_token IS
  'Per-cron-run uuid stamped at claim time. Lets a run identify rows it owns vs rows abandoned by a crashed prior run.';

-- ─── claim_undrained_feedback_events ──────────────────────────────────────
CREATE OR REPLACE FUNCTION claim_undrained_feedback_events(
  p_token uuid,
  p_since timestamptz,
  p_limit int
)
RETURNS SETOF feedback_events
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE feedback_events fe
  SET claimed_at  = now(),
      claim_token = p_token
  WHERE fe.id IN (
    SELECT id FROM feedback_events
    WHERE drained_at IS NULL
      AND created_at >= p_since
      AND (claimed_at IS NULL OR claimed_at < now() - INTERVAL '5 minutes')
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING fe.*;
END;
$$;

COMMENT ON FUNCTION claim_undrained_feedback_events IS
  'Atomic claim for protocole-vivant cron drain. Returns up to N undrained rows (created since p_since) and stamps them with claimed_at + p_token. Concurrent runs see locked rows and skip them. Stale claims (>5 min, drained_at still null) are re-claimable for crash recovery.';

-- ─── claim_undrained_corrections ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION claim_undrained_corrections(
  p_token uuid,
  p_since timestamptz,
  p_limit int,
  p_eligible_channels text[]
)
RETURNS SETOF corrections
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE corrections c
  SET proposition_claimed_at  = now(),
      proposition_claim_token = p_token
  WHERE c.id IN (
    SELECT id FROM corrections
    WHERE proposition_drained_at IS NULL
      AND source_channel = ANY(p_eligible_channels)
      AND created_at >= p_since
      AND (proposition_claimed_at IS NULL
        OR proposition_claimed_at < now() - INTERVAL '5 minutes')
    ORDER BY created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING c.*;
END;
$$;

COMMENT ON FUNCTION claim_undrained_corrections IS
  'Atomic claim for protocole-vivant cron drain (corrections bridge). Filters by source_channel ANY(p_eligible_channels) so the cron sees the same eligibility set as the JS layer. Stale claims (>5 min, proposition_drained_at still null) are re-claimable for crash recovery.';

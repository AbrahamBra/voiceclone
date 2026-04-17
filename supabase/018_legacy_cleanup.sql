-- ============================================================
-- Migration 018 — Document legacy artifacts
-- ============================================================
-- These artifacts were introduced in an earlier 017/018 pair,
-- rolled back when 017_learning_events.sql took the slot.
-- They exist in production and are being re-used:
--   - rate_limit_buckets + rate_limit_check: hybrid rate limiter
--   - personas.last_consolidation_at: consolidation cron scheduling
--
-- This migration is idempotent and declarative — ensures the
-- artifacts exist even on fresh DBs.
-- ============================================================

-- 1. Rate limit table
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  ip text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_updated_at
  ON rate_limit_buckets (updated_at);

-- 2. Atomic rate limit RPC
CREATE OR REPLACE FUNCTION rate_limit_check(
  p_ip text,
  p_window_ms int DEFAULT 60000,
  p_max int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_bucket rate_limit_buckets%ROWTYPE;
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_new_count int;
BEGIN
  INSERT INTO rate_limit_buckets (ip, window_start, count, updated_at)
  VALUES (p_ip, v_now, 1, v_now)
  ON CONFLICT (ip) DO UPDATE SET
    window_start = CASE
      WHEN rate_limit_buckets.window_start < v_now - (p_window_ms || ' ms')::interval
      THEN v_now
      ELSE rate_limit_buckets.window_start
    END,
    count = CASE
      WHEN rate_limit_buckets.window_start < v_now - (p_window_ms || ' ms')::interval
      THEN 1
      ELSE rate_limit_buckets.count + 1
    END,
    updated_at = v_now
  RETURNING * INTO v_bucket;

  v_new_count := v_bucket.count;
  v_window_start := v_bucket.window_start;

  IF v_new_count > p_max THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'count', v_new_count,
      'retry_after',
        GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_window_start + (p_window_ms || ' ms')::interval - v_now))))
    );
  END IF;

  RETURN jsonb_build_object('allowed', true, 'count', v_new_count);
END;
$$;

-- 3. Consolidation scheduling column
ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS last_consolidation_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_personas_last_consolidation
  ON personas (last_consolidation_at NULLS FIRST);

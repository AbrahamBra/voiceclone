-- Migration 053 — fix negative cost_cents from billing bug in logUsage
--
-- Background: lib/supabase.js:128 computed `effectiveInput = inputTokens - cacheRead`
-- assuming Anthropic SDK's input_tokens included cache reads. It does not —
-- input_tokens (uncached) and cache_read_input_tokens are disjoint. Whenever
-- cache hits exceeded uncached input tokens, cost_cents went negative and
-- Math.ceil(costCents) decremented spent_cents via the increment_spent RPC,
-- letting clients silently regenerate budget.
--
-- usage_log does not store cache_read_input_tokens, so an exact recompute is
-- impossible. We clamp to 0 (mild underestimation, ~16 cents total impact
-- across all clients) and recompute spent_cents from the corrected sum.
--
-- Idempotent: re-running zeroes nothing further once cost_cents >= 0.

BEGIN;

-- 1. Clamp negative cost_cents to 0 (data correction)
UPDATE usage_log
SET cost_cents = 0
WHERE cost_cents < 0;

-- 2. Recompute spent_cents from authoritative sum of usage_log per client.
--    Use Math.ceil-equivalent (ceiling) to match the runtime increment behavior.
UPDATE clients c
SET spent_cents = COALESCE(sub.total, 0)
FROM (
  SELECT client_id, CEIL(SUM(cost_cents))::int AS total
  FROM usage_log
  GROUP BY client_id
) sub
WHERE sub.client_id = c.id;

COMMIT;

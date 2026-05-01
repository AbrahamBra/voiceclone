-- Migration 063 — Extend rate_limit_cleanup retention to 25h
--
-- Context: V3.6.6 introduces per-API-key rate limiting reusing the
-- rate_limit_check() RPC from migration 017 with two synthetic key
-- patterns: "apikey-min:<keyId>" (10/min) and "apikey-day:<keyId>" (500/24h).
--
-- The day bucket has a 24h sliding window, but rate_limit_cleanup() was
-- written to delete buckets idle for > 10 minutes — which would prematurely
-- reset the day counter for any key not used continuously. Extending the
-- retention to 25h keeps day buckets alive across their full window plus a
-- 1h safety margin, while still purging stale IP buckets eventually.
--
-- Volume impact is negligible: even at 1000 distinct keys + 10000 IPs/day
-- the table stays in the kB range.

CREATE OR REPLACE FUNCTION rate_limit_cleanup()
RETURNS int
LANGUAGE sql
AS $$
  WITH deleted AS (
    DELETE FROM rate_limit_buckets
    WHERE updated_at < now() - interval '25 hours'
    RETURNING 1
  )
  SELECT count(*)::int FROM deleted;
$$;

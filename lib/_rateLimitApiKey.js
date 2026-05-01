// ============================================================
// Per-API-key rate limiter (V3.6.6).
//
// Reuses the rate_limit_check() RPC from migration 017 — its `p_ip` text
// parameter is content-agnostic, so we feed it synthetic keys :
//   - "apikey-min:<keyId>"  → 10 requests / 60s
//   - "apikey-day:<keyId>"  → 500 requests / 24h
//
// Both windows are checked. The first to reject decides — `scope` in the
// returned object tells the caller which bound was hit so the 429 body
// can surface a useful retryAfter and message.
//
// Fail-open philosophy mirrors the IP limiter : DB unavailable / RPC
// error → allow, log the failure but never break the API surface.
// ============================================================
import { supabase } from "./supabase.js";

const MIN_WINDOW_MS = 60_000;        // 1 minute
const MIN_MAX = 10;
const DAY_WINDOW_MS = 24 * 60 * 60_000; // 24h
const DAY_MAX = 500;

async function checkBucket(key, windowMs, max, scope) {
  const { data, error } = await supabase.rpc("rate_limit_check", {
    p_ip: key,
    p_window_ms: windowMs,
    p_max: max,
  });
  if (error) {
    console.error(JSON.stringify({ event: "rate_limit_apikey_rpc_error", scope, error: error.message }));
    return { allowed: true }; // fail open
  }
  if (data && data.allowed === false) {
    return { allowed: false, scope, retryAfter: data.retry_after || (scope === "min" ? 60 : 3600) };
  }
  return { allowed: true };
}

/**
 * Check both per-key windows. Hits both RPCs even when the first rejects
 * so the day counter reflects rejected attempts too — keeps the 500/day
 * cap honest under burst-then-retry abuse.
 */
export async function rateLimitApiKey(keyId) {
  if (!supabase || !keyId) return { allowed: true };
  try {
    const [minResult, dayResult] = await Promise.all([
      checkBucket(`apikey-min:${keyId}`, MIN_WINDOW_MS, MIN_MAX, "min"),
      checkBucket(`apikey-day:${keyId}`, DAY_WINDOW_MS, DAY_MAX, "day"),
    ]);
    if (!minResult.allowed) return minResult;
    if (!dayResult.allowed) return dayResult;
    return { allowed: true };
  } catch (err) {
    console.error(JSON.stringify({ event: "rate_limit_apikey_exception", error: err.message }));
    return { allowed: true }; // fail open
  }
}

export const _internals = { MIN_WINDOW_MS, MIN_MAX, DAY_WINDOW_MS, DAY_MAX };

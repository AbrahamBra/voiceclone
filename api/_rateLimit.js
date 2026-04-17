// ============================================================
// RATE LIMITER — Supabase source of truth + in-memory cache
// Atomic check+increment via rate_limit_check() RPC (migration 017)
// Survives cold starts, shared across all Vercel instances
// ============================================================

import { supabase } from "../lib/supabase.js";

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 20;

// In-memory short-circuit cache: if we JUST saw this IP and it was blocked,
// reject immediately without a DB roundtrip. TTL = 2 seconds.
const recentBlocks = new Map();

function extractIp(rawIp) {
  if (!rawIp) return "unknown";
  // x-forwarded-for can be "client, proxy1, proxy2" — take first, trim
  const first = String(rawIp).split(",")[0].trim();
  // Reject malformed values (basic sanity, prevents very long attacker-chosen keys)
  if (first.length > 45 || first.length < 3) return "unknown";
  return first;
}

/**
 * Extract the real client IP from a Vercel/Node request object, safely.
 *
 * Vercel sets `x-real-ip` and `x-vercel-forwarded-for` — both are set by the
 * Vercel edge, NOT by the client. We prefer those over `x-forwarded-for`,
 * which a client can trivially spoof (e.g. "x-forwarded-for: 1.2.3.4").
 *
 * Fallback order: x-real-ip → x-vercel-forwarded-for → socket remoteAddress
 * → first entry of x-forwarded-for (last resort, spoofable).
 */
export function getClientIp(req) {
  const h = req.headers || {};
  const candidate =
    h["x-real-ip"] ||
    h["x-vercel-forwarded-for"] ||
    req.socket?.remoteAddress ||
    h["x-forwarded-for"];
  return extractIp(candidate);
}

export async function rateLimit(rawIp) {
  const ip = extractIp(rawIp);
  const now = Date.now();

  // Fast path: if we blocked this IP in the last 2s, reject without DB call
  const recent = recentBlocks.get(ip);
  if (recent && now < recent.until) {
    return { allowed: false, retryAfter: Math.ceil((recent.until - now) / 1000) };
  }

  // If Supabase is down/unavailable, fail open (allow) rather than breaking site
  if (!supabase) {
    return { allowed: true };
  }

  try {
    const { data, error } = await supabase.rpc("rate_limit_check", {
      p_ip: ip,
      p_window_ms: WINDOW_MS,
      p_max: MAX_REQUESTS,
    });

    if (error) {
      console.error(JSON.stringify({ event: "rate_limit_rpc_error", error: error.message }));
      return { allowed: true }; // fail open on DB error
    }

    if (data && data.allowed === false) {
      // Cache the block briefly to protect the DB from hot-loop abuse
      recentBlocks.set(ip, { until: now + 2000 });
      return { allowed: false, retryAfter: data.retry_after || 60 };
    }

    return { allowed: true };
  } catch (err) {
    console.error(JSON.stringify({ event: "rate_limit_exception", error: err.message }));
    return { allowed: true }; // fail open
  }
}

// Periodic cleanup of in-memory recentBlocks (defensive)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of recentBlocks) {
    if (now >= entry.until) recentBlocks.delete(ip);
  }
}, 60_000);

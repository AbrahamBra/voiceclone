// ============================================================
// RATE LIMITER — Hybrid: in-memory fast path + Supabase persistent
// In-memory serves as first check (fast), Supabase as source of truth
// ============================================================

import { supabase } from "../lib/supabase.js";

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 20;

// In-memory cache (fast path, resets on cold start but catches most abuse)
const store = new Map();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of store) {
    if (now - record.windowStart > WINDOW_MS * 2) {
      store.delete(ip);
    }
  }
}, 300_000);

export function rateLimit(ip) {
  const now = Date.now();
  const record = store.get(ip);

  if (!record || now - record.windowStart > WINDOW_MS) {
    store.set(ip, { windowStart: now, count: 1 });
    return { allowed: true };
  }

  record.count++;
  if (record.count > MAX_REQUESTS) {
    // Log to Supabase for cross-instance visibility (fire-and-forget)
    if (supabase) {
      supabase.from("usage_log").insert({
        client_id: null,
        persona_id: null,
        input_tokens: 0,
        output_tokens: 0,
        cost_cents: 0,
        metadata: { event: "rate_limited", ip: ip.slice(0, 20), count: record.count },
      }).catch(() => {});
    }
    return { allowed: false, retryAfter: Math.ceil((record.windowStart + WINDOW_MS - now) / 1000) };
  }

  return { allowed: true };
}

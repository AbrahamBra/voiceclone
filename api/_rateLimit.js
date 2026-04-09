// ============================================================
// RATE LIMITER — In-memory, per-IP, sliding window
// Resets on cold start (acceptable for serverless)
// ============================================================

const store = new Map();
const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 20;

// Cleanup old entries every 5 minutes to prevent memory leaks
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
    return { allowed: false, retryAfter: Math.ceil((record.windowStart + WINDOW_MS - now) / 1000) };
  }

  return { allowed: true };
}

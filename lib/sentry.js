// ============================================================
// SENTRY — lazy, no-op if SENTRY_DSN is absent
// Kept tiny + side-effect free so tests and local dev stay quiet.
// Real init + captureError wiring happens in Blocker 3 (when @sentry/node is installed).
// ============================================================

const DSN = process.env.SENTRY_DSN || "";
const ENABLED = Boolean(DSN);

let client = null;

async function getClient() {
  if (!ENABLED) return null;
  if (client) return client;
  try {
    // Dynamic import so the dep is optional until DSN is set
    const mod = await import("@sentry/node");
    mod.init({
      dsn: DSN,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
      tracesSampleRate: 0,
      sendDefaultPii: false,
    });
    client = mod;
    return client;
  } catch {
    // Package not installed yet — stay silent, don't break handlers
    return null;
  }
}

export function captureError(err, context = {}) {
  if (!ENABLED) return;
  // Fire-and-forget; never await in request path
  getClient().then((c) => {
    if (!c) return;
    try {
      c.captureException(err, { extra: context });
    } catch {
      // Swallow — observability must never break prod
    }
  }).catch(() => {});
}

export function isSentryEnabled() {
  return ENABLED;
}

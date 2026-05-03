// ============================================================
// CRON — Protocole vivant : drain feedback_events + corrections → proposition
//
// Runs every 5 minutes. Wraps scripts/feedback-event-to-proposition.js
// for Vercel's cron runner. Authenticates via CRON_SECRET (same scheme
// as api/cron-consolidate.js).
//
// Two drains run sequentially per invocation:
//   1. drainEventsToProposition (feedback_events table)
//   2. drainCorrectionsToProposition (corrections table — implicit signals
//      like copy_paste_out / regen_rejection / explicit_button)
//
// Per-run budget:
//   - Limit 100 rows per drain
//   - 30 min lookback window (Vercel cron reliability buffer)
//   - 60s maxDuration shared across both drains
//
// Backfill mode: when called with `?backfill=true` (auth still enforced),
// the lookback widens to 30 days and limit to 500 to recover any rows
// missed by prior runs (e.g. corrections logged before this drain was
// wired). Default behavior is unchanged.
// ============================================================

export const maxDuration = 60;

import { supabase as defaultSupabase } from "../lib/supabase.js";
import {
  drainEventsToProposition as defaultDrainEvents,
  drainCorrectionsToProposition as defaultDrainCorrections,
} from "../scripts/feedback-event-to-proposition.js";
import { isProtocolEmbeddingAvailable } from "../lib/protocol-v2-embeddings.js";
import { log } from "../lib/log.js";

const RUN_LIMIT = 100;
const LOOKBACK_MS = 30 * 60 * 1000;
const BACKFILL_LIMIT = 500;
const BACKFILL_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Test seam: tests inject stubs by mutating this object before importing
// the handler. Production callers never touch it.
export const __deps = {
  supabase: defaultSupabase,
  drainEvents: defaultDrainEvents,
  drainCorrections: defaultDrainCorrections,
  isAvailable: isProtocolEmbeddingAvailable,
};

function parseBackfill(req) {
  // Vercel handler passes req.query as an object on the platform; in some
  // test contexts only req.url is set. Accept either.
  if (req?.query && typeof req.query === "object") {
    return req.query.backfill === "true" || req.query.backfill === true;
  }
  if (typeof req?.url === "string") {
    try {
      const u = new URL(req.url, "http://localhost");
      return u.searchParams.get("backfill") === "true";
    } catch {
      return false;
    }
  }
  return false;
}

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  const auth = req.headers["authorization"];
  if (!expected || auth !== `Bearer ${expected}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const supabase = __deps.supabase;
  if (!supabase) {
    res.status(500).json({ error: "Supabase not configured" });
    return;
  }

  const startedAt = Date.now();

  if (!__deps.isAvailable()) {
    log("protocol_v2_cron_skip_no_embeddings", {});
    res.status(200).json({
      ok: true,
      skipped: true,
      reason: "embeddings_not_available",
    });
    return;
  }

  const backfill = parseBackfill(req);
  const limit = backfill ? BACKFILL_LIMIT : RUN_LIMIT;
  const lookbackMs = backfill ? BACKFILL_LOOKBACK_MS : LOOKBACK_MS;

  try {
    const eventsSummary = await __deps.drainEvents({
      supabase,
      limit,
      lookbackMs,
    });
    const correctionsSummary = await __deps.drainCorrections({
      supabase,
      limit,
      lookbackMs,
    });
    const durationMs = Date.now() - startedAt;
    log("protocol_v2_cron_done", {
      backfill,
      events: eventsSummary,
      corrections: correctionsSummary,
      duration_ms: durationMs,
    });
    res.status(200).json({
      ok: true,
      backfill,
      // Preserve legacy `summary` field (events-only) so existing dashboards/
      // alerts don't break.
      summary: {
        processed: eventsSummary.processed,
        merged: eventsSummary.merged,
        inserted: eventsSummary.inserted,
        silenced: eventsSummary.silenced,
        skipped: eventsSummary.skipped,
      },
      events: {
        processed: eventsSummary.processed,
        merged: eventsSummary.merged,
        inserted: eventsSummary.inserted,
        silenced: eventsSummary.silenced,
        skipped: eventsSummary.skipped,
      },
      corrections: {
        processed: correctionsSummary.processed,
        merged: correctionsSummary.merged,
        inserted: correctionsSummary.inserted,
        silenced: correctionsSummary.silenced,
        skipped: correctionsSummary.skipped,
      },
      duration_ms: durationMs,
    });
  } catch (err) {
    log("protocol_v2_cron_error", { message: err?.message });
    res.status(500).json({ ok: false, error: err?.message || "drain failed" });
  }
}

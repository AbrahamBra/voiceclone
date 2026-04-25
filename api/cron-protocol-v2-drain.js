// ============================================================
// CRON — Protocole vivant : drain feedback_events → proposition
//
// Runs every 5 minutes. Wraps scripts/feedback-event-to-proposition.js
// for Vercel's cron runner. Authenticates via CRON_SECRET (same scheme
// as api/cron-consolidate.js).
//
// Per-run budget:
//   - Limit 100 events
//   - 30 min lookback window (Vercel cron reliability buffer)
//   - 60s maxDuration (each event = 1 router call ~2s + 1-2 extractor
//     calls ~5-10s + 1 embed ~200ms + 1 dedup query ~50ms)
// ============================================================

export const maxDuration = 60;

import { supabase } from "../lib/supabase.js";
import { drainEventsToProposition } from "../scripts/feedback-event-to-proposition.js";
import { isProtocolEmbeddingAvailable } from "../lib/protocol-v2-embeddings.js";
import { log } from "../lib/log.js";

const RUN_LIMIT = 100;
const LOOKBACK_MS = 30 * 60 * 1000;

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  const auth = req.headers["authorization"];
  if (!expected || auth !== `Bearer ${expected}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!supabase) {
    res.status(500).json({ error: "Supabase not configured" });
    return;
  }

  const startedAt = Date.now();

  if (!isProtocolEmbeddingAvailable()) {
    log("protocol_v2_cron_skip_no_embeddings", {});
    res.status(200).json({
      ok: true,
      skipped: true,
      reason: "embeddings_not_available",
    });
    return;
  }

  try {
    const summary = await drainEventsToProposition({
      supabase,
      limit: RUN_LIMIT,
      lookbackMs: LOOKBACK_MS,
    });
    const durationMs = Date.now() - startedAt;
    log("protocol_v2_cron_done", { ...summary, duration_ms: durationMs });
    res.status(200).json({
      ok: true,
      summary: {
        processed: summary.processed,
        merged: summary.merged,
        inserted: summary.inserted,
        silenced: summary.silenced,
        skipped: summary.skipped,
      },
      duration_ms: durationMs,
    });
  } catch (err) {
    log("protocol_v2_cron_error", { message: err?.message });
    res.status(500).json({ ok: false, error: err?.message || "drain failed" });
  }
}

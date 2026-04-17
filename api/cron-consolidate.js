// ============================================================
// CRON — Consolidation scheduler
// Runs every 10 minutes. Scans personas with recent feedback activity
// and triggers consolidation sequentially (no races, no fire-and-forget).
//
// Vercel authenticates cron calls via Authorization: Bearer <CRON_SECRET>
// ============================================================

export const maxDuration = 300;

import { supabase } from "../lib/supabase.js";
import { consolidateCorrections } from "../lib/correction-consolidation.js";

// Minimum active corrections to trigger a consolidation (match old threshold)
const MIN_ACTIVE_CORRECTIONS = 10;

// Hard cap: never consolidate more than N personas per run (stay within maxDuration)
const MAX_PERSONAS_PER_RUN = 20;

export default async function handler(req, res) {
  // Vercel cron sends a Bearer token matching CRON_SECRET env var
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
  const results = [];

  try {
    // Find personas with enough active corrections that are candidates.
    // We use the intelligence_source_id if the persona shares intelligence,
    // otherwise the persona's own id.
    const { data: personas, error } = await supabase
      .from("personas")
      .select("id, slug, client_id, intelligence_source_id, last_consolidation_at")
      .order("last_consolidation_at", { ascending: true, nullsFirst: true })
      .limit(100);

    if (error) throw error;
    if (!personas || personas.length === 0) {
      res.status(200).json({ ok: true, scanned: 0, consolidated: 0, durationMs: Date.now() - startedAt });
      return;
    }

    // Dedup by intelligence source (shared personas consolidate once)
    const seenIntelIds = new Set();
    const candidates = [];

    for (const p of personas) {
      const intelId = p.intelligence_source_id || p.id;
      if (seenIntelIds.has(intelId)) continue;
      seenIntelIds.add(intelId);

      // Count active corrections for this intelligence source
      const { count } = await supabase
        .from("corrections")
        .select("id", { count: "exact", head: true })
        .eq("persona_id", intelId)
        .eq("status", "active");

      if ((count || 0) >= MIN_ACTIVE_CORRECTIONS) {
        candidates.push({ personaId: p.id, intelId, activeCount: count });
      }

      if (candidates.length >= MAX_PERSONAS_PER_RUN) break;
    }

    // Consolidate sequentially (no parallel — avoids writingRules races)
    for (const c of candidates) {
      try {
        const result = await consolidateCorrections(c.personaId);
        results.push({ personaId: c.personaId, ok: true, ...result });

        // Stamp last run time (ignore error: column might not exist yet)
        await supabase.from("personas")
          .update({ last_consolidation_at: new Date().toISOString() })
          .eq("id", c.personaId)
          .then(() => {}, () => {});
      } catch (err) {
        results.push({ personaId: c.personaId, ok: false, error: err.message });
        console.error(JSON.stringify({ event: "cron_consolidate_error", personaId: c.personaId, error: err.message }));
      }
    }

    const summary = {
      ok: true,
      scanned: personas.length,
      candidates: candidates.length,
      consolidated: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      durationMs: Date.now() - startedAt,
      results,
    };
    console.log(JSON.stringify({ event: "cron_consolidate_summary", ...summary }));
    res.status(200).json(summary);
  } catch (err) {
    console.error(JSON.stringify({ event: "cron_consolidate_fatal", error: err.message }));
    res.status(500).json({ error: err.message, durationMs: Date.now() - startedAt });
  }
}

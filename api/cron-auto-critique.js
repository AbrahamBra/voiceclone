// CRON — N3 auto-critique : IA relit les sorties récentes de chaque clone
// actif et émet des learning_events 'auto_critique' pour chaque violation.
//
// Runs every 6 hours. Authenticates via CRON_SECRET (same scheme as
// api/cron-consolidate.js and api/cron-protocol-v2-drain.js).

export const maxDuration = 300;

import { supabase } from "../lib/supabase.js";
import { critiquePersona } from "../lib/auto-critique-core.js";
import { log } from "../lib/log.js";

const MAX_PERSONAS_PER_RUN = 10;
const RESERVE_MS = 60_000;
const ACTIVITY_WINDOW_HOURS = 24;

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

  // Only audit personas with conversation activity in the last window —
  // older clones have no fresh bot output worth re-reading.
  const cutoff = new Date(Date.now() - ACTIVITY_WINDOW_HOURS * 3600 * 1000).toISOString();
  const { data: recent, error } = await supabase
    .from("conversations")
    .select("persona_id")
    .gte("last_message_at", cutoff);

  if (error) {
    log("cron_auto_critique_query_error", { message: error.message });
    res.status(500).json({ error: error.message });
    return;
  }

  const personaIds = [...new Set((recent || []).map(r => r.persona_id).filter(Boolean))];
  const audited = [];

  for (const personaId of personaIds.slice(0, MAX_PERSONAS_PER_RUN)) {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > maxDuration * 1000 - RESERVE_MS) {
      log("cron_auto_critique_budget_stop", { elapsedMs });
      break;
    }
    try {
      const r = await critiquePersona(personaId);
      audited.push({ personaId, ok: true, ...r });
    } catch (err) {
      audited.push({ personaId, ok: false, error: err.message });
      log("cron_auto_critique_persona_error", { personaId, message: err.message });
    }
  }

  const summary = {
    ok: true,
    scanned: personaIds.length,
    audited: audited.length,
    emitted: audited.reduce((s, a) => s + (a.emitted || 0), 0),
    skipped: audited.filter(a => a.skipped).length,
    durationMs: Date.now() - startedAt,
    results: audited,
  };
  log("cron_auto_critique_done", summary);
  res.status(200).json(summary);
}

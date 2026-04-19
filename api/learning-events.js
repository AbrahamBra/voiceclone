import { authenticateRequest, supabase, setCors, hasPersonaAccess } from "../lib/supabase.js";

/**
 * GET /api/learning-events?persona=<id>&limit=50
 * Returns the last N learning events for a persona, newest first.
 */
export default async function handler(req, res) {
  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const personaId = req.query?.persona;
  if (!personaId) {
    res.status(400).json({ error: "persona param required" });
    return;
  }

  if (!isAdmin) {
    if (!(await hasPersonaAccess(client?.id, personaId))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }

  const limit = Math.min(parseInt(req.query?.limit, 10) || 50, 200);

  const { data, error } = await supabase
    .from("learning_events")
    .select("id, event_type, payload, fidelity_before, fidelity_after, collapse_before, collapse_after, created_at")
    .eq("persona_id", personaId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.log(JSON.stringify({ event: "learning_events_fetch_error", ts: new Date().toISOString(), persona: personaId, error: error.message }));
    res.status(500).json({ error: "Failed to fetch learning events" });
    return;
  }

  const events = data || [];

  // Backfill legacy `rule_added` events written before the payload included
  // { rules } (pre-2026-04-20). The synthesized rule text is recoverable from
  // the `corrections` table: detectDirectInstruction inserts one row per rule
  // with bot_message='[direct-instruction]' and user_message = the same slice
  // that was stored as source_message. We match on (intelligence scope,
  // user_message, time window) and enrich in-place — no DB write.
  const legacy = events.filter(e => e.event_type === "rule_added"
    && (!Array.isArray(e.payload?.rules) || e.payload.rules.length === 0)
    && e.payload?.source_message);

  if (legacy.length > 0) {
    // corrections are scoped to the intelligence source, not the persona
    const { data: persona } = await supabase
      .from("personas")
      .select("intelligence_source_id")
      .eq("id", personaId)
      .single();
    const intellId = persona?.intelligence_source_id || personaId;

    const srcMessages = [...new Set(legacy.map(e => e.payload.source_message))];
    const { data: corrections } = await supabase
      .from("corrections")
      .select("correction, user_message, created_at")
      .eq("persona_id", intellId)
      .eq("bot_message", "[direct-instruction]")
      .in("user_message", srcMessages);

    if (Array.isArray(corrections) && corrections.length > 0) {
      for (const evt of legacy) {
        const evtTime = Date.parse(evt.created_at);
        // ±60s window is generous: event + correction insert happen back-to-back
        const matches = corrections.filter(c =>
          c.user_message === evt.payload.source_message
          && Math.abs(Date.parse(c.created_at) - evtTime) < 60_000
        );
        if (matches.length > 0) {
          evt.payload = { ...evt.payload, rules: matches.map(m => m.correction) };
        }
      }
    }
  }

  res.json({ events });
}

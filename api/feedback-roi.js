import { authenticateRequest, supabase, setCors, hasPersonaAccess } from "../lib/supabase.js";
import { getIntelligenceId } from "../lib/knowledge-db.js";

/**
 * GET /api/feedback-roi?persona=<id>&days=7
 * Returns the feedback ROI counters for a persona over the window.
 *   - signals_in  : feedback_events grouped by event_type
 *   - signals_out : learning_events grouped by event_type (incl. positive_reinforcement,
 *                   entity_boost, consolidation_run — surfaces the outcomes of those signals)
 *   - rules_graduated : corrections promoted to status=graduated in the window
 *                       (scoped via intelligence_source_id, same as the consolidation pipeline)
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
  if (!personaId) { res.status(400).json({ error: "persona param required" }); return; }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, personaId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const days = Math.min(Math.max(parseInt(req.query?.days, 10) || 7, 1), 90);
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  // Resolve intellId for corrections scope
  const { data: personaRow } = await supabase
    .from("personas").select("id, intelligence_source_id").eq("id", personaId).single();
  const intellId = personaRow ? getIntelligenceId(personaRow) : personaId;

  const [fbRes, leRes, gradRes] = await Promise.all([
    supabase.from("feedback_events")
      .select("event_type").eq("persona_id", personaId).gte("created_at", since),
    supabase.from("learning_events")
      .select("event_type, payload").eq("persona_id", personaId).gte("created_at", since),
    supabase.from("corrections")
      .select("id", { count: "exact", head: true })
      .eq("persona_id", intellId).eq("status", "graduated").gte("created_at", since),
  ]);

  const signals_in = {};
  let totalSignalsIn = 0;
  for (const row of fbRes.data || []) {
    signals_in[row.event_type] = (signals_in[row.event_type] || 0) + 1;
    totalSignalsIn++;
  }

  const signals_out = {};
  let totalEntitiesBoosted = 0;
  for (const row of leRes.data || []) {
    signals_out[row.event_type] = (signals_out[row.event_type] || 0) + 1;
    if (row.event_type === "entity_boost") {
      totalEntitiesBoosted += Number(row.payload?.matched_entities || 0);
    }
  }

  res.json({
    window_days: days,
    since,
    signals_in: { total: totalSignalsIn, by_type: signals_in },
    signals_out: { by_type: signals_out, entities_boosted: totalEntitiesBoosted },
    rules_graduated: gradRes.count || 0,
  });
}

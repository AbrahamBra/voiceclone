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

  res.json({ events: data || [] });
}

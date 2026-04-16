import { authenticateRequest, setCors } from "../lib/supabase.js";
import { aggregateMetrics, aggregateAllMetrics, getHealthSummary } from "../lib/metrics.js";

export default async function handler(req, res) {
  setCors(res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  let client, isAdmin;
  try {
    const auth = await authenticateRequest(req);
    client = auth.client;
    isAdmin = auth.isAdmin;
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  if (!isAdmin) { res.status(403).json({ error: "Admin only" }); return; }

  // GET: health summary for a persona
  if (req.method === "GET") {
    const personaId = req.query?.persona_id;
    if (!personaId) { res.status(400).json({ error: "persona_id required" }); return; }
    const summary = await getHealthSummary(personaId);
    res.status(200).json(summary || { error: "No metrics yet" });
    return;
  }

  // POST: trigger aggregation
  if (req.method === "POST") {
    const { persona_id, date, all } = req.body || {};
    if (all) {
      const results = await aggregateAllMetrics(date);
      res.status(200).json({ aggregated: results.length });
    } else if (persona_id) {
      const result = await aggregateMetrics(persona_id, date);
      res.status(200).json(result || { error: "Failed to aggregate" });
    } else {
      res.status(400).json({ error: "persona_id or all required" });
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}

// N3 Auto-critique — IA relit ses propres outputs vs les règles actives.
// POST /api/auto-critique  { personaId: "uuid" }
// Émet des learning_events "auto_critique" pour chaque violation détectée.
// Core logic in lib/auto-critique-core.js, also used by api/cron-auto-critique.js.

import { authenticateRequest, hasPersonaAccess, setCors } from "../lib/supabase.js";
import { critiquePersona } from "../lib/auto-critique-core.js";

export default async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const { personaId } = req.body || {};
  if (!personaId) {
    res.status(400).json({ error: "personaId is required" }); return;
  }

  if (!isAdmin) {
    const hasAccess = await hasPersonaAccess(client?.id, personaId);
    if (!hasAccess) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }

  const result = await critiquePersona(personaId);
  res.json(result);
}

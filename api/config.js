import { parse } from "url";
import { authenticateRequest, supabase, setCors } from "../lib/supabase.js";
import { getPersonaFromDb } from "../lib/knowledge-db.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const { client, isAdmin } = await authenticateRequest(req);

    const { query } = parse(req.url, true);
    const personaId = query.persona;
    if (!personaId) { res.status(400).json({ error: "persona query param required" }); return; }

    const persona = await getPersonaFromDb(personaId);
    if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

    if (!isAdmin && persona.client_id !== client?.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Build public config (strip voice, file paths)
    const scenarios = {};
    for (const [key, val] of Object.entries(persona.scenarios)) {
      scenarios[key] = {
        label: val.label,
        description: (val.description || "").replace(/\{name\}/g, persona.name),
        welcome: val.welcome || null,
      };
    }

    res.json({
      id: persona.id,
      name: persona.name,
      title: persona.title,
      avatar: persona.avatar,
      scenarios,
      theme: persona.theme,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.error || "Server error" });
  }
}

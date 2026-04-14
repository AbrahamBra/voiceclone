import { authenticateRequest, supabase, setCors } from "../lib/supabase.js";
import { clearCache } from "../lib/knowledge-db.js";

export default async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    await authenticateRequest(req);
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const { correction, botMessage, userMessage, persona: personaId } = req.body || {};

  if (!personaId) { res.status(400).json({ error: "persona is required" }); return; }
  if (!correction || typeof correction !== "string" || correction.length < 3 || correction.length > 500) {
    res.status(400).json({ error: "correction must be a string of 3-500 chars" });
    return;
  }

  const { error } = await supabase.from("corrections").insert({
    persona_id: personaId,
    correction,
    user_message: userMessage?.slice(0, 200) || null,
    bot_message: botMessage?.slice(0, 300) || null,
  });

  if (error) {
    res.status(500).json({ error: "Failed to save correction" });
    return;
  }

  // Clear cache so next request picks up the new correction
  clearCache(personaId);

  res.json({ ok: true, message: "Correction enregistree" });
}

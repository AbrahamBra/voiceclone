import { authenticateRequest, setCors } from "../lib/supabase.js";
import { runEval } from "../lib/eval.js";

export default async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  let client, isAdmin;
  try {
    const auth = await authenticateRequest(req);
    client = auth.client;
    isAdmin = auth.isAdmin;
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  // Admin only
  if (!isAdmin) { res.status(403).json({ error: "Admin only" }); return; }

  const { persona_id, limit = 50, verbose = false } = req.body || {};
  if (!persona_id) { res.status(400).json({ error: "persona_id required" }); return; }

  try {
    const result = await runEval(persona_id, { limit, client, verbose });
    res.status(200).json(result);
  } catch (err) {
    console.log(JSON.stringify({ event: "eval_error", ts: new Date().toISOString(), error: err.message }));
    res.status(500).json({ error: err.message });
  }
}

import { authenticateRequest, supabase, setCors } from "../lib/supabase.js";

export default async function handler(req, res) {
  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  let client;
  try {
    const auth = await authenticateRequest(req);
    if (auth.isAdmin) { res.status(400).json({ error: "Admin cannot set API key" }); return; }
    client = auth.client;
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const { anthropic_api_key } = req.body || {};

  if (anthropic_api_key !== undefined) {
    if (anthropic_api_key && !anthropic_api_key.startsWith("sk-ant-")) {
      res.status(400).json({ error: "Invalid Anthropic API key format" });
      return;
    }

    const { error } = await supabase
      .from("clients")
      .update({ anthropic_api_key: anthropic_api_key || null })
      .eq("id", client.id);

    if (error) { res.status(500).json({ error: "Failed to update" }); return; }
  }

  res.json({ ok: true });
}

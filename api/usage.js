import { authenticateRequest, supabase, setCors } from "../lib/supabase.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  let client, isAdmin;
  try {
    const auth = await authenticateRequest(req);
    client = auth.client;
    isAdmin = auth.isAdmin;
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  if (isAdmin) {
    // Admin: return all clients with usage
    const { data: clients } = await supabase
      .from("clients")
      .select("id, name, tier, budget_cents, spent_cents, created_at")
      .order("created_at", { ascending: false });

    res.json({ clients: clients || [] });
  } else {
    // Client: return their own usage
    const { data: logs } = await supabase
      .from("usage_log")
      .select("input_tokens, output_tokens, cost_cents, created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(50);

    res.json({
      budget_cents: client.budget_cents,
      spent_cents: client.spent_cents,
      remaining_cents: Math.max(0, client.budget_cents - client.spent_cents),
      has_own_key: !!client.anthropic_api_key,
      log: logs || [],
    });
  }
}

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

  // ── Admin: metrics view ──
  if (isAdmin && req.query?.view === "metrics") {
    try {
      const now = new Date();
      const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
      const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

      const [
        { count: totalPersonas },
        { count: totalClients },
        { count: totalCorrections },
        { count: recentCorrections },
        { count: totalEntities },
        { count: totalConversations },
        { data: recentUsage },
      ] = await Promise.all([
        supabase.from("personas").select("*", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("clients").select("*", { count: "exact", head: true }).eq("is_active", true),
        supabase.from("corrections").select("*", { count: "exact", head: true }),
        supabase.from("corrections").select("*", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
        supabase.from("knowledge_entities").select("*", { count: "exact", head: true }),
        supabase.from("conversations").select("*", { count: "exact", head: true }).gte("updated_at", sevenDaysAgo),
        supabase.from("usage_log").select("input_tokens, output_tokens, cost_cents").gte("created_at", oneDayAgo),
      ]);

      const usage24h = (recentUsage || []).reduce((acc, row) => ({
        input_tokens: acc.input_tokens + (row.input_tokens || 0),
        output_tokens: acc.output_tokens + (row.output_tokens || 0),
        cost_cents: acc.cost_cents + (row.cost_cents || 0),
        requests: acc.requests + 1,
      }), { input_tokens: 0, output_tokens: 0, cost_cents: 0, requests: 0 });

      res.json({
        overview: {
          personas: totalPersonas || 0,
          clients: totalClients || 0,
          conversations_7d: totalConversations || 0,
        },
        quality: {
          total_corrections: totalCorrections || 0,
          corrections_7d: recentCorrections || 0,
          corrections_per_day: Math.round((recentCorrections || 0) / 7 * 10) / 10,
          knowledge_entities: totalEntities || 0,
        },
        usage_24h: {
          requests: usage24h.requests,
          input_tokens: usage24h.input_tokens,
          output_tokens: usage24h.output_tokens,
          cost_eur: Math.round(usage24h.cost_cents) / 100,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // ── Admin: client list ──
  if (isAdmin) {
    const { data: clients } = await supabase
      .from("clients")
      .select("id, name, tier, budget_cents, spent_cents, created_at")
      .order("created_at", { ascending: false });

    res.json({ clients: clients || [] });
    return;
  }

  // ── Client: own usage ──
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

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

  // ── Admin: per-client activity ──
  if (isAdmin && req.query?.view === "clients") {
    try {
      const now = new Date();
      const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [
        { data: clients },
        { data: usageLogs },
        { data: recentConvs },
      ] = await Promise.all([
        supabase.from("clients").select("id, name, tier, budget_cents, spent_cents, created_at").eq("is_active", true).order("created_at", { ascending: false }),
        supabase.from("usage_log").select("client_id, input_tokens, output_tokens").gte("created_at", sevenDaysAgo),
        supabase.from("conversations").select("client_id, last_message_at").gte("last_message_at", sevenDaysAgo),
      ]);

      // Aggregate usage by client
      const usageByClient = {};
      for (const row of (usageLogs || [])) {
        if (!row.client_id) continue;
        const a = usageByClient[row.client_id] ||= { tokens: 0, requests: 0 };
        a.tokens += (row.input_tokens || 0) + (row.output_tokens || 0);
        a.requests += 1;
      }

      // Aggregate conversations by client
      const convByClient = {};
      for (const row of (recentConvs || [])) {
        if (!row.client_id) continue;
        const a = convByClient[row.client_id] ||= { count: 0, last_active: null };
        a.count += 1;
        if (!a.last_active || row.last_message_at > a.last_active) a.last_active = row.last_message_at;
      }

      const result = (clients || []).map(c => ({
        id: c.id,
        name: c.name,
        tier: c.tier,
        budget_cents: c.budget_cents || 0,
        spent_cents: c.spent_cents || 0,
        remaining_cents: Math.max(0, (c.budget_cents || 0) - (c.spent_cents || 0)),
        tokens_7d: usageByClient[c.id]?.tokens || 0,
        requests_7d: usageByClient[c.id]?.requests || 0,
        conversations_7d: convByClient[c.id]?.count || 0,
        last_active: convByClient[c.id]?.last_active || null,
      }));

      res.json({ clients: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // ── Admin: per-persona stats ──
  if (isAdmin && req.query?.view === "personas") {
    try {
      const [
        { data: personasList },
        { data: clientsList },
        { data: corrections },
        { data: entities },
        { data: convs },
      ] = await Promise.all([
        supabase.from("personas").select("id, name, slug, avatar, client_id").eq("is_active", true),
        supabase.from("clients").select("id, name"),
        supabase.from("corrections").select("persona_id"),
        supabase.from("knowledge_entities").select("persona_id"),
        supabase.from("conversations").select("persona_id"),
      ]);

      const clientMap = {};
      for (const c of (clientsList || [])) clientMap[c.id] = c.name;

      const corrCount = {};
      for (const c of (corrections || [])) corrCount[c.persona_id] = (corrCount[c.persona_id] || 0) + 1;

      const entCount = {};
      for (const e of (entities || [])) entCount[e.persona_id] = (entCount[e.persona_id] || 0) + 1;

      const convCount = {};
      for (const c of (convs || [])) convCount[c.persona_id] = (convCount[c.persona_id] || 0) + 1;

      const result = (personasList || []).map(p => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        avatar: p.avatar,
        client_name: clientMap[p.client_id] || "—",
        conversations: convCount[p.id] || 0,
        corrections: corrCount[p.id] || 0,
        entities: entCount[p.id] || 0,
      }));

      res.json({ personas: result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // ── Admin: recent activity feed ──
  if (isAdmin && req.query?.view === "activity") {
    try {
      const { data: recentConvs } = await supabase
        .from("conversations")
        .select("id, title, scenario, last_message_at, persona_id, client_id")
        .order("last_message_at", { ascending: false })
        .limit(20);

      // Lookup names
      const personaIds = [...new Set((recentConvs || []).map(c => c.persona_id).filter(Boolean))];
      const clientIds = [...new Set((recentConvs || []).map(c => c.client_id).filter(Boolean))];

      const [{ data: personasList }, { data: clientsList }] = await Promise.all([
        personaIds.length > 0
          ? supabase.from("personas").select("id, name, avatar").in("id", personaIds)
          : { data: [] },
        clientIds.length > 0
          ? supabase.from("clients").select("id, name").in("id", clientIds)
          : { data: [] },
      ]);

      const personaMap = {};
      for (const p of (personasList || [])) { personaMap[p.id] = { name: p.name, avatar: p.avatar }; }
      const clientMap = {};
      for (const c of (clientsList || [])) clientMap[c.id] = c.name;

      const activity = (recentConvs || []).map(c => ({
        id: c.id,
        title: c.title || "Sans titre",
        scenario: c.scenario,
        last_message_at: c.last_message_at,
        persona_name: personaMap[c.persona_id]?.name || "—",
        persona_avatar: personaMap[c.persona_id]?.avatar || "?",
        client_name: clientMap[c.client_id] || "—",
      }));

      res.json({ activity });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // ── Admin: client list (default) ──
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

  const budget = client.budget_cents || 0;
  const spent = client.spent_cents || 0;
  res.json({
    budget_cents: budget,
    spent_cents: spent,
    remaining_cents: Math.max(0, budget - spent),
    has_own_key: !!client.anthropic_api_key,
    log: logs || [],
  });
}

// ============================================================
// GET /api/heat?conversation_id=<uuid>
// Returns current prospect heat + narrative signals for the chat thermometer.
// ============================================================
import { authenticateRequest, supabase, hasPersonaAccess, setCors } from "../lib/supabase.js";
import { extract, deriveState } from "../lib/heat/narrativeSignals.js";

export default async function handler(req, res) {
  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "method_not_allowed" }); return; }

  const convId = (req.query?.conversation_id || "").trim();
  if (!convId) return res.status(400).json({ error: "conversation_id required" });

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }
  if (!client) { res.status(403).json({ error: "Auth failed" }); return; }

  // Access check
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id, persona_id, client_id")
    .eq("id", convId)
    .maybeSingle();
  if (convErr || !conv) { res.status(404).json({ error: "conversation_not_found" }); return; }
  if (!isAdmin) {
    const ok = await hasPersonaAccess(client.id, conv.persona_id);
    if (!ok) { res.status(404).json({ error: "conversation_not_found" }); return; }
  }

  // Fetch heat rows + messages
  const { data: heatRows } = await supabase
    .from("prospect_heat")
    .select("message_id, heat, delta, signals, created_at")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true });

  const { data: messages } = await supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true })
    .limit(200);

  // DB role is "user"/"assistant", narrativeSignals expects "user"/"bot"
  const normalized = (messages || []).map(m => ({
    ...m,
    role: m.role === "assistant" ? "bot" : m.role,
  }));

  const { signals, total } = extract({
    messages: normalized,
    heatRows: heatRows || [],
    now: new Date(),
  });

  const lastHeat = (heatRows && heatRows.length) ? heatRows[heatRows.length - 1] : null;
  const heat = lastHeat ? Number(lastHeat.heat) : null;
  const delta = lastHeat ? (lastHeat.delta != null ? Number(lastHeat.delta) : null) : null;
  const { state, direction } = deriveState(heat, delta);

  return res.status(200).json({
    current: { heat, delta, state, direction },
    signals,
    total_signals: total,
  });
}

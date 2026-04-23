// ============================================================
// Operating protocol API
//
// GET  /api/protocol?persona=<id>           → list protocols + rules for a persona
// POST /api/protocol?id=<id>&action=activate   → activate (deactivates siblings)
// POST /api/protocol?id=<id>&action=deactivate → deactivate
// DELETE /api/protocol?id=<id>                 → delete (cascade to rules)
//
// Auth: same pattern as api/knowledge.js (authenticateRequest + hasPersonaAccess).
// ============================================================

export const maxDuration = 30;

import { authenticateRequest, supabase, hasPersonaAccess, setCors } from "../lib/supabase.js";
import { getIntelligenceId } from "../lib/knowledge-db.js";
import { activateProtocol, deactivateProtocol } from "../lib/protocol-activator.js";
import { clearProtocolCache } from "../lib/protocol-db.js";

async function assertPersonaAccess(req, isAdmin, client, personaId) {
  if (isAdmin) return true;
  return hasPersonaAccess(client?.id, personaId);
}

async function loadProtocolWithPersona(protocolId) {
  const { data } = await supabase
    .from("operating_protocols")
    .select("id, persona_id, status, is_active, version, activated_at, source_file_id, parser_model, parser_confidence, parse_error, parse_attempts")
    .eq("id", protocolId)
    .single();
  return data || null;
}

export default async function handler(req, res) {
  setCors(res, "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  // ── GET: list protocols + rules for a persona ──
  if (req.method === "GET") {
    const personaId = req.query?.persona;
    if (!personaId) { res.status(400).json({ error: "persona is required" }); return; }
    if (!(await assertPersonaAccess(req, isAdmin, client, personaId))) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const { data: persona } = await supabase
      .from("personas").select("id, intelligence_source_id").eq("id", personaId).single();
    if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }
    const intellId = getIntelligenceId(persona);

    const { data: protocols } = await supabase
      .from("operating_protocols")
      .select("id, status, is_active, version, activated_at, created_at, source_file_id, parser_model, parser_confidence, parse_error, parse_attempts")
      .eq("persona_id", intellId)
      .order("created_at", { ascending: false });

    const list = protocols || [];
    if (list.length === 0) { res.json({ protocols: [] }); return; }

    const ids = list.map(p => p.id);
    const { data: rules } = await supabase
      .from("protocol_hard_rules")
      .select("protocol_id, rule_id, description, check_kind, check_params, applies_to_scenarios, severity, source_quote")
      .in("protocol_id", ids);

    const rulesByProto = {};
    for (const r of rules || []) {
      (rulesByProto[r.protocol_id] ||= []).push(r);
    }

    res.json({
      protocols: list.map(p => ({
        ...p,
        rules: rulesByProto[p.id] || [],
      })),
    });
    return;
  }

  const protocolId = req.query?.id;
  if (!protocolId) { res.status(400).json({ error: "id is required" }); return; }

  const proto = await loadProtocolWithPersona(protocolId);
  if (!proto) { res.status(404).json({ error: "Protocol not found" }); return; }
  if (!(await assertPersonaAccess(req, isAdmin, client, proto.persona_id))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  // ── POST: activate/deactivate ──
  if (req.method === "POST") {
    const action = req.query?.action;
    if (action === "activate") {
      const r = await activateProtocol(protocolId);
      if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
      res.json({ ok: true });
      return;
    }
    if (action === "deactivate") {
      const r = await deactivateProtocol(protocolId);
      if (!r.ok) { res.status(400).json({ error: r.reason }); return; }
      res.json({ ok: true });
      return;
    }
    res.status(400).json({ error: "action must be activate or deactivate" });
    return;
  }

  // ── DELETE: delete protocol (hard rules cascade) ──
  if (req.method === "DELETE") {
    const { error } = await supabase
      .from("operating_protocols").delete().eq("id", protocolId);
    if (error) { res.status(500).json({ error: error.message }); return; }
    // Best-effort cache invalidation. Without knowing intellId, clear by persona_id
    // (cached key may also be the intellId itself — this covers both cases).
    clearProtocolCache(proto.persona_id);
    res.json({ ok: true });
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
}

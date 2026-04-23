// ============================================================
// Protocol activation — toggles is_active on operating_protocols
// and invalidates the protocol cache so the pipeline picks up
// changes immediately.
//
// Only ONE protocol can be active per persona at a time.
// Activating a new one deactivates siblings.
// ============================================================

import { supabase } from "./supabase.js";
import { clearProtocolCache } from "./protocol-db.js";

async function resolveIntellId(personaId) {
  const { data } = await supabase
    .from("personas")
    .select("id, intelligence_source_id")
    .eq("id", personaId)
    .single();
  return data ? (data.intelligence_source_id || data.id) : personaId;
}

/**
 * Activate a protocol. Deactivates all other protocols on the same persona.
 * Requires status='parsed'. Returns { ok: true } or { ok: false, reason }.
 */
export async function activateProtocol(protocolId) {
  const { data: proto, error } = await supabase
    .from("operating_protocols")
    .select("id, persona_id, status, is_active")
    .eq("id", protocolId)
    .single();
  if (error || !proto) return { ok: false, reason: "not_found" };
  if (proto.status !== "parsed") return { ok: false, reason: `status=${proto.status}` };
  if (proto.is_active) return { ok: true, reason: "already_active" };

  // Deactivate siblings first (single-active invariant).
  await supabase
    .from("operating_protocols")
    .update({ is_active: false })
    .eq("persona_id", proto.persona_id)
    .neq("id", protocolId);

  const { error: upErr } = await supabase
    .from("operating_protocols")
    .update({ is_active: true, activated_at: new Date().toISOString() })
    .eq("id", protocolId);
  if (upErr) return { ok: false, reason: upErr.message };

  const intellId = await resolveIntellId(proto.persona_id);
  clearProtocolCache(intellId);
  return { ok: true };
}

/**
 * Deactivate a protocol. Preserves all hard rules (re-activatable later).
 */
export async function deactivateProtocol(protocolId) {
  const { data: proto } = await supabase
    .from("operating_protocols")
    .select("id, persona_id, is_active")
    .eq("id", protocolId)
    .single();
  if (!proto) return { ok: false, reason: "not_found" };
  if (!proto.is_active) return { ok: true, reason: "already_inactive" };

  const { error } = await supabase
    .from("operating_protocols")
    .update({ is_active: false })
    .eq("id", protocolId);
  if (error) return { ok: false, reason: error.message };

  const intellId = await resolveIntellId(proto.persona_id);
  clearProtocolCache(intellId);
  return { ok: true };
}

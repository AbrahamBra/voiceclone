// ============================================================
// Operating protocol loader — mirrors lib/knowledge-db.js pattern.
//
// Resolves via intelligence_source_id (shared pool) so clones
// inherit the protocol of their master persona. 5-minute in-memory
// cache invalidated by clearProtocolCache(intellId) on activate/
// deactivate/delete.
// ============================================================

import { supabase } from "./supabase.js";
import { getIntelligenceId } from "./knowledge-db.js";

const _cache = {};
const CACHE_TTL = 5 * 60 * 1000;

async function loadProtocolData(personaId) {
  const now = Date.now();
  if (_cache[personaId] && now - _cache[personaId].ts < CACHE_TTL) {
    return _cache[personaId].data;
  }

  const { data: persona } = await supabase
    .from("personas")
    .select("id, intelligence_source_id")
    .eq("id", personaId)
    .single();
  if (!persona) return null;

  const intellId = getIntelligenceId(persona);

  // Active protocol only — most recent wins if multiple (shouldn't happen,
  // but activator enforces single-active semantically; defensive here).
  const { data: protocols } = await supabase
    .from("operating_protocols")
    .select("id, version, activated_at, parser_model, parser_confidence")
    .eq("persona_id", intellId)
    .eq("is_active", true)
    .order("activated_at", { ascending: false, nullsFirst: false })
    .limit(1);

  const protocol = protocols?.[0] || null;
  let rules = [];
  if (protocol) {
    const { data: r } = await supabase
      .from("protocol_hard_rules")
      .select("rule_id, description, check_kind, check_params, applies_to_scenarios, severity, source_quote")
      .eq("protocol_id", protocol.id);
    rules = r || [];
  }

  const result = { intellId, protocol, rules };
  _cache[personaId] = { ts: now, data: result };
  return result;
}

/**
 * Return the active protocol row for a persona (or null).
 */
export async function getActiveProtocol(personaId) {
  const data = await loadProtocolData(personaId);
  return data?.protocol || null;
}

/**
 * Return active hard rules for a persona, filtered by scenario.
 * A rule with applies_to_scenarios=null applies to all scenarios.
 */
export async function getActiveHardRules(personaId, scenario = null) {
  const data = await loadProtocolData(personaId);
  if (!data || data.rules.length === 0) return [];
  if (!scenario) return data.rules;
  return data.rules.filter(r =>
    !r.applies_to_scenarios || r.applies_to_scenarios.length === 0 ||
    r.applies_to_scenarios.includes(scenario)
  );
}

/**
 * Invalidate cache for an intelligence source and all clones using it.
 * Same pattern as clearIntelligenceCache in knowledge-db.js.
 */
export function clearProtocolCache(intellId) {
  delete _cache[intellId];
  for (const key of Object.keys(_cache)) {
    if (_cache[key]?.data?.intellId === intellId) {
      delete _cache[key];
    }
  }
}

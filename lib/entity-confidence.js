import { supabase } from "./supabase.js";

/**
 * Adjust confidence on entities whose name appears in `botMessage`.
 * Positive `delta` boosts (clamped to 1.0), negative demotes (clamped to 0.0).
 * Returns matched entity count.
 */
export async function adjustEntityConfidence(personaId, botMessage, delta) {
  const { data: entities } = await supabase
    .from("knowledge_entities")
    .select("id, name, confidence")
    .eq("persona_id", personaId);

  if (!entities?.length || !botMessage) return 0;

  const msgLower = botMessage.toLowerCase();
  const matched = entities.filter(e => msgLower.includes(e.name.toLowerCase()));

  for (const e of matched) {
    const base = e.confidence || 0.8;
    const newConf = delta >= 0
      ? Math.min(1.0, base + delta)
      : Math.max(0.0, base + delta);
    await supabase.from("knowledge_entities")
      .update({ confidence: newConf, last_matched_at: new Date().toISOString() })
      .eq("id", e.id);
  }

  return matched.length;
}

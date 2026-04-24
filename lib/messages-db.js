// ============================================================
// Outbound clone messages reader — used by the protocol dry-run
// endpoint to replay new rules against the clone's history.
//
// Pulls assistant-authored messages (turn_kind clone_draft or toi)
// joined with their conversation so the scenario column travels
// with each row — checkProtocolRules needs it to apply scoped rules.
// ============================================================

import { supabase } from "./supabase.js";

/**
 * Fetch the N most recent outbound messages for a persona, with the
 * conversation scenario attached to each row.
 *
 * @param {string} personaId
 * @param {number} [limit=50]
 * @returns {Promise<Array<{id:string, content:string, conversation_id:string, created_at:string, scenario:string|null}>>}
 */
export async function getPersonaOutgoingMessages(personaId, limit = 50) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, content, conversation_id, created_at, conversations!inner(persona_id, scenario)")
    .eq("conversations.persona_id", personaId)
    .eq("role", "assistant")
    .in("turn_kind", ["clone_draft", "toi"])
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return (data || []).map(m => ({
    id: m.id,
    content: m.content,
    conversation_id: m.conversation_id,
    created_at: m.created_at,
    scenario: m.conversations?.scenario || null,
  }));
}

// Stage pipeline auto-dérivé (DM uniquement). Slugs canoniques :
//   to_contact | first_message | in_conv | follow_up | closing
// Voir migration 035_stage_auto.sql pour la sémantique + backfill.

export const STAGE_SLUGS = Object.freeze({
  TO_CONTACT: "to_contact",
  FIRST_MESSAGE: "first_message",
  IN_CONV: "in_conv",
  FOLLOW_UP: "follow_up",
  CLOSING: "closing",
});

const ALL_SLUGS = new Set(Object.values(STAGE_SLUGS));

export function isStageSlug(value) {
  return typeof value === "string" && ALL_SLUGS.has(value);
}

/**
 * Logique pure de dérivation du stage. Isolée de Supabase pour la testabilité.
 *
 * @param {{
 *   scenario?: string|null,
 *   scenarioType?: string|null,
 *   hasToi?: boolean,
 *   hasProspect?: boolean,
 * }} signals
 * @returns {string|null} slug à écrire, ou null si pas applicable (scope hors-DM).
 */
export function deriveStageSlug({ scenario, scenarioType, hasToi, hasProspect }) {
  // DM uniquement — un post n'a pas de pipeline de lead.
  if (scenario !== "dm") return null;

  if (scenarioType === "DM_closing") return STAGE_SLUGS.CLOSING;
  if (scenarioType === "DM_relance" && hasProspect) return STAGE_SLUGS.FOLLOW_UP;
  if (hasProspect) return STAGE_SLUGS.IN_CONV;
  if (hasToi) return STAGE_SLUGS.FIRST_MESSAGE;
  return STAGE_SLUGS.TO_CONTACT;
}

/**
 * Recompute le stage d'une conv à partir des signaux courants en DB.
 * No-op si stage_auto=false (override opérateur) ou si la conv n'est pas en DM.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} convId
 * @param {{ scenarioTypeHint?: string|null }} [opts]
 * @returns {Promise<string|null>} stage slug écrit, ou null si no-op.
 */
export async function recomputeStage(supabase, convId, { scenarioTypeHint = null } = {}) {
  if (!supabase || !convId) return null;

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, scenario_type, stage_auto, scenario")
    .eq("id", convId)
    .single();
  if (!conv) return null;
  if (conv.stage_auto === false) return null;

  const { data: msgs } = await supabase
    .from("messages")
    .select("turn_kind")
    .eq("conversation_id", convId)
    .eq("message_type", "chat");
  const rows = msgs || [];

  const next = deriveStageSlug({
    scenario: conv.scenario,
    scenarioType: scenarioTypeHint || conv.scenario_type || null,
    hasToi: rows.some((m) => m.turn_kind === "toi"),
    hasProspect: rows.some((m) => m.turn_kind === "prospect"),
  });
  if (!next) return null;

  await supabase.from("conversations").update({ stage: next }).eq("id", convId);
  return next;
}

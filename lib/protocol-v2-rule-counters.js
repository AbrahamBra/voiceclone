/**
 * lib/protocol-v2-rule-counters.js
 *
 * Helpers pour le pattern "rule helpful/harmful counters" inspiré de
 * ace-agent/ace (papier arXiv:2510.04618).
 *
 * Cycle de vie d'un firing :
 *
 *   1. Génération chat → on logue les artifacts qui ont influencé
 *      la sortie via recordFiring(). outcome='pending'.
 *   2. Le user agit sur le message :
 *        - copy / accept / publish        → resolveFirings('helpful')
 *        - correction explicite / regen   → resolveFirings('harmful')
 *        - aucune action sous N jours     → resolveFirings('unrelated')
 *   3. Cron Curator (quotidien) → proposeRetirement() inspecte les
 *      ratios harmful/total et émet des propositions remove_rule ou
 *      amend_paragraph dans la queue `proposition`.
 *
 * Aucun caller wired pour l'instant — l'intégration dans api/chat.js
 * et api/feedback.js viendra dans une PR follow-up après merge des PRs
 * #122 (migration 048) et #123 (drain fix).
 */

const DEFAULT_RETIREMENT_MIN_FIRINGS = 6;
const DEFAULT_RETIREMENT_HARMFUL_RATIO = 0.6;

/**
 * Log a firing — called when one or more artifacts have influenced
 * the generation of an assistant message.
 *
 * @param {object} args
 * @param {object} args.supabase - service-role client
 * @param {string[]} args.artifactIds - artifacts that fired during generation
 * @param {string} args.messageId - the assistant message id (uuid)
 * @param {string} [args.conversationId]
 * @param {string} [args.personaId]
 * @returns {Promise<{inserted: number}>}
 */
export async function recordFiring({
  supabase,
  artifactIds,
  messageId,
  conversationId,
  personaId,
}) {
  if (!supabase) throw new Error("supabase client required");
  if (!Array.isArray(artifactIds) || artifactIds.length === 0) {
    return { inserted: 0 };
  }

  const rows = artifactIds.map((artifact_id) => ({
    artifact_id,
    message_id: messageId,
    conversation_id: conversationId ?? null,
    persona_id: personaId ?? null,
    outcome: "pending",
  }));

  const { data, error } = await supabase
    .from("protocol_rule_firing")
    .insert(rows)
    .select("id");

  if (error) {
    return { inserted: 0, error: error.message };
  }
  return { inserted: data?.length ?? 0 };
}

/**
 * Resolve all pending firings for a message — bulk-update outcome and
 * increment the corresponding counters on protocol_artifact.stats.
 *
 * @param {object} args
 * @param {object} args.supabase
 * @param {string} args.messageId
 * @param {'helpful'|'harmful'|'unrelated'} args.outcome
 * @returns {Promise<{resolved: number, artifactsUpdated: number}>}
 */
export async function resolveFirings({ supabase, messageId, outcome }) {
  if (!supabase) throw new Error("supabase client required");
  if (!["helpful", "harmful", "unrelated"].includes(outcome)) {
    throw new Error(`invalid outcome: ${outcome}`);
  }

  // 1. Find pending firings for this message.
  const { data: pending, error: queryErr } = await supabase
    .from("protocol_rule_firing")
    .select("id, artifact_id")
    .eq("message_id", messageId)
    .eq("outcome", "pending");

  if (queryErr) return { resolved: 0, artifactsUpdated: 0, error: queryErr.message };
  if (!pending || pending.length === 0) {
    return { resolved: 0, artifactsUpdated: 0 };
  }

  // 2. Bulk update outcome.
  const ids = pending.map((r) => r.id);
  const { error: updErr } = await supabase
    .from("protocol_rule_firing")
    .update({ outcome, resolved_at: new Date().toISOString() })
    .in("id", ids);
  if (updErr) return { resolved: 0, artifactsUpdated: 0, error: updErr.message };

  // 3. Increment counters on each artifact's stats jsonb.
  // unrelated firings update fires_total but not helpful/harmful.
  const counterKey =
    outcome === "helpful" ? "helpful_count" : outcome === "harmful" ? "harmful_count" : null;

  const artifactCounts = pending.reduce((acc, r) => {
    acc[r.artifact_id] = (acc[r.artifact_id] || 0) + 1;
    return acc;
  }, {});

  let artifactsUpdated = 0;
  for (const [artifactId, increment] of Object.entries(artifactCounts)) {
    const { data: row, error: fetchErr } = await supabase
      .from("protocol_artifact")
      .select("stats")
      .eq("id", artifactId)
      .maybeSingle();
    if (fetchErr || !row) continue;

    const stats = row.stats || {};
    const next = {
      ...stats,
      fires_total: (stats.fires_total ?? stats.fires ?? 0) + increment,
      last_fired_at: new Date().toISOString(),
    };
    if (counterKey) {
      next[counterKey] = (stats[counterKey] ?? 0) + increment;
    }

    const { error: writeErr } = await supabase
      .from("protocol_artifact")
      .update({ stats: next })
      .eq("id", artifactId);
    if (!writeErr) artifactsUpdated++;
  }

  return { resolved: pending.length, artifactsUpdated };
}

/**
 * Curator job — find artifacts with bad helpful/harmful balance over
 * enough firings, and propose their retirement.
 *
 * @param {object} args
 * @param {object} args.supabase
 * @param {number} [args.minFirings=6]
 * @param {number} [args.harmfulRatio=0.6]
 * @param {string} [args.documentId] - scope to one document. If omitted, all docs.
 * @param {boolean} [args.dryRun=false]
 * @returns {Promise<{candidates: Array, proposed: number}>}
 */
export async function proposeRetirement({
  supabase,
  minFirings = DEFAULT_RETIREMENT_MIN_FIRINGS,
  harmfulRatio = DEFAULT_RETIREMENT_HARMFUL_RATIO,
  documentId,
  dryRun = false,
}) {
  if (!supabase) throw new Error("supabase client required");

  // Pull artifacts via a join through protocol_section to filter by document.
  let query = supabase
    .from("protocol_artifact")
    .select(
      "id, kind, content, severity, stats, source_section_id, " +
        "protocol_section!inner(document_id)",
    )
    .eq("is_active", true);

  if (documentId) {
    query = query.eq("protocol_section.document_id", documentId);
  }

  const { data: artifacts, error } = await query;
  if (error) return { candidates: [], proposed: 0, error: error.message };

  const candidates = (artifacts || [])
    .map((a) => {
      const fires = a.stats?.fires_total ?? a.stats?.fires ?? 0;
      const harmful = a.stats?.harmful_count ?? 0;
      const ratio = fires > 0 ? harmful / fires : 0;
      return { artifact: a, fires, harmful, ratio };
    })
    .filter((c) => c.fires >= minFirings && c.ratio >= harmfulRatio);

  if (dryRun) return { candidates, proposed: 0 };

  let proposed = 0;
  for (const c of candidates) {
    const docId = c.artifact.protocol_section?.document_id;
    if (!docId) continue;

    const proposedText =
      c.artifact.content?.text ||
      c.artifact.content?.rule ||
      JSON.stringify(c.artifact.content).slice(0, 200);

    const { error: insertErr } = await supabase.from("proposition").insert({
      document_id: docId,
      source: "analytics_cron",
      source_ref: c.artifact.id,
      source_refs: [c.artifact.id],
      count: c.harmful,
      intent: "remove_rule",
      target_kind: c.artifact.kind === "hard_check" ? "hard_rules" : "errors",
      target_section_id: c.artifact.source_section_id,
      proposed_text: proposedText,
      rationale: `Règle au ratio harmful=${(c.ratio * 100).toFixed(0)}% sur ${c.fires} firings (≥ ${minFirings}). Curator propose retrait.`,
      confidence: Math.min(0.95, 0.5 + c.ratio * 0.5),
      status: "pending",
    });
    if (!insertErr) proposed++;
  }

  return { candidates, proposed };
}

export const RETIREMENT_DEFAULTS = Object.freeze({
  MIN_FIRINGS: DEFAULT_RETIREMENT_MIN_FIRINGS,
  HARMFUL_RATIO: DEFAULT_RETIREMENT_HARMFUL_RATIO,
});

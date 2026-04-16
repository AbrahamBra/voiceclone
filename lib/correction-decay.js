/**
 * Pure functions for correction confidence decay.
 * Decay window: 120 days. Floor: 30% of stored confidence.
 */

const DECAY_WINDOW_DAYS = 120;
const DECAY_FLOOR = 0.3;
const EFFECTIVE_FLOOR = 0.15; // below this, correction is hidden

/**
 * Compute effective confidence = stored_confidence * recency_factor.
 * recency_factor decays linearly from 1.0 to DECAY_FLOOR over DECAY_WINDOW_DAYS.
 */
export function applyConfidenceDecay(storedConfidence, createdAt) {
  const daysSince = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  const recencyFactor = Math.max(DECAY_FLOOR, 1.0 - (daysSince / DECAY_WINDOW_DAYS));
  return Math.round(storedConfidence * recencyFactor * 100) / 100;
}

/**
 * Find correction IDs to suppress due to contradictions.
 * When two corrections are linked by a "contradicts" relation (via their entities),
 * the older one is suppressed — the user's most recent instruction wins.
 */
function findContradictionLosers(corrections, entities, relations) {
  if (!entities?.length || !relations?.length) return new Set();

  const contradictPairs = relations.filter(r => r.relation_type === "contradicts");
  if (contradictPairs.length === 0) return new Set();

  // Build entity id → name map
  const entityNames = {};
  for (const e of entities) entityNames[e.id] = e.name?.toLowerCase() || "";

  // Match entity names to corrections (same fuzzy approach as negative feedback detection)
  function correctionMatchesEntity(corrText, entityName) {
    if (!corrText || !entityName || entityName.length < 3) return false;
    const cl = corrText.toLowerCase();
    return cl.includes(entityName) || entityName.includes(cl.slice(0, 30).toLowerCase());
  }

  const losers = new Set();
  for (const pair of contradictPairs) {
    const fromName = entityNames[pair.from_entity_id];
    const toName = entityNames[pair.to_entity_id];
    if (!fromName || !toName) continue;

    // Find corrections matching each side of the contradiction
    const fromCorrs = corrections.filter(c => correctionMatchesEntity(c.correction, fromName));
    const toCorrs = corrections.filter(c => correctionMatchesEntity(c.correction, toName));

    if (fromCorrs.length === 0 || toCorrs.length === 0) continue;

    // Most recent correction on each side
    const fromLatest = fromCorrs.reduce((a, b) => new Date(a.created_at) > new Date(b.created_at) ? a : b);
    const toLatest = toCorrs.reduce((a, b) => new Date(a.created_at) > new Date(b.created_at) ? a : b);

    // The older side loses — all its corrections are suppressed
    if (new Date(fromLatest.created_at) > new Date(toLatest.created_at)) {
      for (const c of toCorrs) losers.add(c.id);
    } else {
      for (const c of fromCorrs) losers.add(c.id);
    }
  }

  return losers;
}

/**
 * Format corrections with decay applied + contradiction resolution.
 * Filters out archived, low-confidence, and contradiction losers.
 * Sorts by effective confidence DESC.
 */
export function formatCorrectionsWithDecay(corrections, entities, relations) {
  if (!corrections || corrections.length === 0) return null;

  const suppressedIds = findContradictionLosers(corrections, entities, relations);

  const scored = corrections
    .filter(c => c.status !== "archived")
    .filter(c => !suppressedIds.has(c.id))
    .map(c => ({
      ...c,
      effectiveConf: applyConfidenceDecay(c.confidence ?? 0.8, c.created_at),
    }))
    .filter(c => c.effectiveConf >= EFFECTIVE_FLOOR)
    .sort((a, b) => b.effectiveConf - a.effectiveConf);

  if (scored.length === 0) return null;

  let md = "# Corrections apprises\n\n";
  for (const c of scored) {
    const date = new Date(c.created_at).toISOString().split("T")[0];
    md += `- **${date}** — ${c.correction}\n`;
    if (c.user_message) md += `  - Contexte: "${c.user_message.slice(0, 100)}"\n`;
    if (c.bot_message) md += `  - Reponse: "${c.bot_message.slice(0, 150)}"\n`;
  }
  return md;
}

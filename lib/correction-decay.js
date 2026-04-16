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
 * Format corrections with decay applied.
 * Filters out archived + low-confidence, sorts by effective confidence DESC.
 */
export function formatCorrectionsWithDecay(corrections) {
  if (!corrections || corrections.length === 0) return null;

  const scored = corrections
    .filter(c => c.status !== "archived")
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

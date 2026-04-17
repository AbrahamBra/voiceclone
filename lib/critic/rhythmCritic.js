/**
 * RhythmCritic — orchestrator.
 * SHADOW MODE ONLY (Phase 1-2).
 *
 * Couches de signal :
 *   - Setter baseline (règles universelles, setterBaseline.js)
 *   - Signal B micro-métriques rythmiques (rhythmMetrics.js)
 *   - Mahalanobis diagonale vs corpus gold persona (mahalanobis.js, v2+)
 */

import { evaluateSetterBaseline } from "./setterBaseline.js";
import { computeRhythmMetrics } from "./rhythmMetrics.js";
import { extractDraft } from "./extractDraft.js";
import { mahalanobisDistance } from "./mahalanobis.js";
import { supabase } from "../supabase.js";

const CRITIC_VERSION = "v3-shadow-mahalanobis";
const DEFAULT_FLAG_THRESHOLD = 0.30;

// Cache in-process des baselines par persona (TTL 1h).
const BASELINE_TTL_MS = 60 * 60 * 1000;
const baselineCache = new Map(); // persona_id -> { baseline, fetched_at }

async function getBaseline(personaId) {
  if (!personaId || !supabase) return null;
  const cached = baselineCache.get(personaId);
  if (cached && Date.now() - cached.fetched_at < BASELINE_TTL_MS) {
    return cached.baseline;
  }
  const { data, error } = await supabase
    .from("rhythm_baselines")
    .select("mean, std, sample_count, baseline_version")
    .eq("persona_id", personaId)
    .maybeSingle();
  if (error) {
    console.error("[rhythmCritic] baseline fetch failed", error.message);
    return null;
  }
  baselineCache.set(personaId, { baseline: data || null, fetched_at: Date.now() });
  return data || null;
}

/**
 * Pure evaluation. No IO.
 * @param {string} text
 * @param {object} ctx - { baseline, threshold, ...setterCtx }
 */
export function evaluateRhythm(text, ctx = {}) {
  const cleaned = extractDraft(text) || text;

  const setter = evaluateSetterBaseline(cleaned, ctx);
  const maxScore = setter.maxScore || 1;
  const violationScore = setter.violationScore;
  const setterScore = 1 - violationScore / maxScore;
  const threshold = typeof ctx.threshold === "number" ? ctx.threshold : DEFAULT_FLAG_THRESHOLD;

  const metrics = computeRhythmMetrics(cleaned);
  const mahal = ctx.baseline ? mahalanobisDistance(metrics, ctx.baseline) : null;

  const reasons = setter.violations.map(v => v.id + ":" + v.reason);
  if (mahal && mahal.dominant_z >= 2) {
    reasons.push(`rhythm_drift:${mahal.dominant_dim}(z=${mahal.dominant_z})`);
  }

  // Flag si setter dépasse ou si Mahalanobis s'éloigne fortement (|z|>=2 sur dim dominante).
  const setterFlag = violationScore / maxScore >= threshold;
  const mahalFlag = mahal ? mahal.dominant_z >= 2 : false;
  const shouldFlag = setterFlag || mahalFlag;

  const signals = {
    setter_violation_score: +violationScore.toFixed(3),
    setter_max_score: +maxScore.toFixed(3),
    setter_ratio: +(violationScore / maxScore).toFixed(3),
    ...metrics,
  };
  if (mahal) {
    signals.mahalanobis_distance = mahal.distance;
    signals.mahalanobis_dominant_dim = mahal.dominant_dim;
    signals.mahalanobis_dominant_z = mahal.dominant_z;
    signals.mahalanobis_per_dim_z = mahal.per_dim_z;
  }

  return {
    score: +setterScore.toFixed(4),
    signals,
    reasons,
    shouldFlag,
    violations: setter.violations,
    thresholdUsed: threshold,
    baselineUsed: !!ctx.baseline,
  };
}

/**
 * Fire-and-forget shadow log.
 */
export async function logRhythmShadow({ personaId, conversationId = null, messageId = null, draft, ctx = {} }) {
  if (!personaId || !draft || !supabase) return null;
  try {
    const baseline = await getBaseline(personaId);
    const result = evaluateRhythm(draft, { ...ctx, baseline });
    await supabase.from("rhythm_shadow").insert({
      persona_id: personaId,
      conversation_id: conversationId,
      message_id: messageId,
      draft,
      score: result.score,
      signals: result.signals,
      reasons: result.reasons,
      would_flag: result.shouldFlag,
      threshold_used: result.thresholdUsed,
      critic_version: CRITIC_VERSION,
    });
    return result;
  } catch (err) {
    console.error("[rhythmCritic] shadow log failed", err.message);
    return null;
  }
}

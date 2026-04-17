/**
 * RhythmCritic — orchestrator.
 * SHADOW MODE ONLY for Phase 1.
 * Evaluates a draft against multiple baselines and logs the result.
 * Does NOT gate generation; returns `shouldFlag` for observation.
 *
 * Baselines wired:
 *   - Couche 1a : setterBaseline (universal sales mechanics)
 *   - Couche 1b : linkedinCopyBaseline (DM craft — pending integration)
 *   - Couche 2  : persona overrides (persona.json `setter_overrides` + `linkedin_overrides`)
 *   - Couche 3  : learned corrections (future)
 */

import { evaluateSetterBaseline } from "./setterBaseline.js";
import { createSupabaseAdmin } from "../supabase.js";

const CRITIC_VERSION = "v1-shadow-setter-only";

// Default flag threshold: 30% of max possible violation weight.
// Calibrated later via eval/cases/rhythm-thomas.json.
const DEFAULT_FLAG_THRESHOLD = 0.30;

/**
 * Pure evaluation. No IO.
 * @param {string} text
 * @param {object} ctx - { isFirstContact, prospectFirstName, personaOverrides, threshold }
 * @returns {{ score, signals, reasons, shouldFlag, violations, thresholdUsed }}
 */
export function evaluateRhythm(text, ctx = {}) {
  const setter = evaluateSetterBaseline(text, ctx);

  const maxScore = setter.maxScore || 1;
  const violationScore = setter.violationScore;
  const score = +(1 - violationScore / maxScore).toFixed(4); // 1 = clean, 0 = full violation
  const threshold = typeof ctx.threshold === "number" ? ctx.threshold : DEFAULT_FLAG_THRESHOLD;
  const shouldFlag = violationScore / maxScore >= threshold;

  const reasons = setter.violations.map(v => v.id + ":" + v.reason);
  const signals = {
    setter_violation_score: +violationScore.toFixed(3),
    setter_max_score: +maxScore.toFixed(3),
    setter_ratio: +(violationScore / maxScore).toFixed(3),
  };

  return {
    score,
    signals,
    reasons,
    shouldFlag,
    violations: setter.violations,
    thresholdUsed: threshold,
  };
}

/**
 * Fire-and-forget shadow log. Never blocks the pipeline.
 * @param {object} params - { personaId, conversationId, messageId, draft, ctx }
 */
export async function logRhythmShadow({ personaId, conversationId = null, messageId = null, draft, ctx = {} }) {
  if (!personaId || !draft) return null;
  try {
    const result = evaluateRhythm(draft, ctx);
    const sb = createSupabaseAdmin();
    await sb.from("rhythm_shadow").insert({
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

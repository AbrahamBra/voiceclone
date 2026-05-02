/**
 * RhythmCritic — setter + rythme + voix.
 *
 * Mode :
 *   - Rythme & Mahalanobis : SHADOW (log uniquement, pas de rewrite)
 *   - Voix V1/V2 (forbidden words, verbe anglais conjugué) : GUARD — promu en
 *     violation hard par pipeline.js, déclenche le rewrite existant.
 *   - Voix V3 (tirets connecteurs) : SHADOW (soft flag, juste logué).
 *
 * Portée honnête (après eval cross-persona v1.2) :
 *   ✓ Détecte les drafts rythmiquement monotones / robotiques (LLM déraillé)
 *   ✗ NE détecte PAS la dérive de voix persona (Thomas vs Thierry, etc.)
 *   ✗ NE détecte PAS le non-respect des mécaniques métier (closing question, CTA)
 *
 * Raison : les métriques de structure (longueurs, fragments, transitions) sont
 * largement partagées entre vendeurs LinkedIn qui respectent les bonnes
 * pratiques DM. La singularité d'une voix réside dans le lexique et le
 * registre, pas dans la structure — domaine d'un autre critic à construire.
 *
 * Couches :
 *   - Setter rules (règles universelles, incl. mécaniques métier D2/D3)
 *   - Signal B micro-métriques (rhythmMetrics.js)
 *   - Mahalanobis diagonale vs corpus gold persona (mahalanobis.js)
 *
 * Historique de calibration (résumé des décisions) :
 *   - v1-shadow-setter-only : setter rules seulement
 *   - v2-shadow-setter+metrics : ajout Signal B micro-métriques brutes
 *   - v3-shadow-mahalanobis : distance Mahalanobis diagonale vs gold persona
 *   - v3.1 : retiré rm_dryness du baseline. Conflait rythme et prescription
 *     métier (« finir par ? »), déjà du ressort des règles setter. Générait
 *     des faux positifs sur follow-ups courts légitimes.
 *   - Eval cross-persona : autres personas humaines ont z̄ comparable aux golds
 *     Thomas → les 7 dims restantes mesurent des bonnes pratiques DM universelles,
 *     pas la voix Thomas. Détecteur de "LLM rythmiquement déraillé", pas de
 *     "pas du Thomas". Un critic lexical/voix séparé reste à construire.
 */

import { evaluateSetterBaseline } from "./setterBaseline.js";
import { computeRhythmMetrics } from "./rhythmMetrics.js";
import { extractDraft } from "./extractDraft.js";
import { mahalanobisDistance } from "./mahalanobis.js";
import { evaluateVoice } from "./voiceCritic.js";
import { supabase } from "../supabase.js";

const DEFAULT_FLAG_THRESHOLD = 0.30;

// Mahalanobis flag threshold. Was `dominant_z >= 2` per dim, which under H0
// gives ~28% false-positive rate across 7 independent dims (1 - (1-0.0455)^7).
// We now flag on the global Mahalanobis distance against a chi-squared
// critical value at df=7, p=0.05 → sqrt(14.07) ≈ 3.75. Per-dim z scores are
// still surfaced in `signals` and the dominant dim is still named in the
// reason, but the gate is the joint distance — not a single dim spiking.
const MAHALANOBIS_FLAG_DISTANCE = 3.75;

// Cache in-process (TTL 1h) des baselines ET des persona.voice par persona.
const CACHE_TTL_MS = 60 * 60 * 1000;
const baselineCache = new Map();
const voiceCache = new Map();

async function getBaseline(personaId) {
  if (!personaId || !supabase) return null;
  const cached = baselineCache.get(personaId);
  if (cached && Date.now() - cached.fetched_at < CACHE_TTL_MS) return cached.baseline;
  const { data, error } = await supabase
    .from("rhythm_baselines")
    .select("mean, std, sample_count, baseline_version")
    .eq("persona_id", personaId)
    .maybeSingle();
  if (error) { console.error("[rhythmCritic] baseline fetch failed", error.message); return null; }
  baselineCache.set(personaId, { baseline: data || null, fetched_at: Date.now() });
  return data || null;
}

async function getPersonaVoice(personaId) {
  if (!personaId || !supabase) return null;
  const cached = voiceCache.get(personaId);
  if (cached && Date.now() - cached.fetched_at < CACHE_TTL_MS) return cached.voice;
  const { data, error } = await supabase
    .from("personas").select("voice").eq("id", personaId).maybeSingle();
  if (error) { console.error("[rhythmCritic] voice fetch failed", error.message); return null; }
  voiceCache.set(personaId, { voice: data?.voice || null, fetched_at: Date.now() });
  return data?.voice || null;
}

/**
 * Pure evaluation — setter + rythme + voix.
 * @param {string} text
 * @param {object} ctx - { baseline, personaVoice, threshold, ...setterCtx }
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
  const voice = evaluateVoice(cleaned, ctx.personaVoice || {});

  const reasons = setter.violations.map(v => v.id + ":" + v.reason);
  if (mahal && mahal.distance >= MAHALANOBIS_FLAG_DISTANCE) {
    reasons.push(`rhythm_drift:d=${mahal.distance}/dom=${mahal.dominant_dim}(z=${mahal.dominant_z})`);
  }
  reasons.push(...voice.reasons);

  const setterFlag = violationScore / maxScore >= threshold;
  const mahalFlag = mahal ? mahal.distance >= MAHALANOBIS_FLAG_DISTANCE : false;
  const shouldFlag = setterFlag || mahalFlag || voice.shouldFlag;

  const shadowIds = (setter.shadowViolations || []).map(v => v.id);
  const signals = {
    setter_violation_score: +violationScore.toFixed(3),
    setter_max_score: +maxScore.toFixed(3),
    setter_ratio: +(violationScore / maxScore).toFixed(3),
    setter_shadow_count: shadowIds.length,
    setter_shadow_ids: shadowIds,
    ...metrics,
    ...voice.signals,
  };
  if (mahal) {
    signals.mahalanobis_distance = mahal.distance;
    signals.mahalanobis_dominant_dim = mahal.dominant_dim;
    signals.mahalanobis_dominant_z = mahal.dominant_z;
    signals.mahalanobis_per_dim_z = mahal.per_dim_z;
  }

  // Score global : min entre le score setter et le score voice — un seul mot
  // interdit doit suffire à tirer le score vers le bas, indépendamment du setter.
  const combinedScore = Math.min(setterScore, voice.score);

  return {
    score: +combinedScore.toFixed(4),
    signals,
    reasons,
    shouldFlag,
    violations: [...setter.violations, ...voice.violations],
    thresholdUsed: threshold,
    baselineUsed: !!ctx.baseline,
    voiceUsed: !!(ctx.personaVoice && (ctx.personaVoice.forbiddenWords || ctx.personaVoice.signaturePhrases)),
  };
}

/**
 * Évalue un draft contre baseline + voice persona (fetch avec cache 1h).
 * Pure évaluation — ne touche pas à la DB côté insert.
 */
export async function evaluateAgainstPersona(draft, { personaId, ctx = {} }) {
  if (!draft) return null;
  const [baseline, personaVoice] = await Promise.all([
    getBaseline(personaId),
    ctx.personaVoice ? Promise.resolve(ctx.personaVoice) : getPersonaVoice(personaId),
  ]);
  return evaluateRhythm(draft, { ...ctx, baseline, personaVoice });
}

// Sprint A purge (2026-05-01) : `persistShadow` and `logRhythmShadow` were
// removed along with the rhythm_shadow table. They wrote 180 rows in prod
// without ever being read by anything other than diagnostic scripts. The
// critic still runs synchronously via evaluateAgainstPersona and pushes V1
// (forbidden_word_persona) and V2 (anglicized_verb) violations into the
// pipeline rewrite path — only the audit-trail persistence was dropped.

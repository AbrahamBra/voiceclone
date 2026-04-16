/**
 * Correction consolidation via embeddings — auto-adaptive with backtest.
 *
 * Pipeline:
 * 1. Embed all active corrections via Voyage
 * 2. Cluster by cosine similarity (ADAPTIVE threshold per persona)
 * 3. Synthesize each cluster (3+ members) via Haiku (TYPED: operational vs abstract)
 * 4. Snapshot fidelity score BEFORE promotion
 * 5. Promote synthesized rules to persona.voice.writingRules
 * 6. Snapshot fidelity score AFTER promotion
 * 7. If composite score drops > 5 points → auto-revert all promoted rules
 * 8. Mark original corrections as status: "graduated"
 *
 * Run periodically (after every 10th correction, or daily cron).
 */

import Anthropic from "@anthropic-ai/sdk";
import { supabase, getApiKey } from "./supabase.js";
import { embed } from "./embeddings.js";
import { clearIntelligenceCache, getIntelligenceId } from "./knowledge-db.js";
import { cosineSim, calculateFidelityScore } from "./fidelity.js";

const MIN_CLUSTER_SIZE = 3;
const DEFAULT_THRESHOLD = 0.75;
const MAX_WRITING_RULES = 25;
const BACKTEST_REVERT_DELTA = -5; // auto-revert if composite score drops by more than 5

/**
 * Compute adaptive clustering threshold from embedding distribution.
 * threshold = clamp(median - 0.8 * stddev, 0.65, 0.85)
 * Falls back to DEFAULT_THRESHOLD if < 5 embeddings.
 */
function computeAdaptiveThreshold(embeddings) {
  if (embeddings.length < 5) return DEFAULT_THRESHOLD;

  // Sample pairwise similarities (cap at 200 pairs for performance)
  const sims = [];
  const maxPairs = Math.min(embeddings.length * (embeddings.length - 1) / 2, 200);
  let count = 0;
  for (let i = 0; i < embeddings.length && count < maxPairs; i++) {
    for (let j = i + 1; j < embeddings.length && count < maxPairs; j++) {
      sims.push(cosineSim(embeddings[i], embeddings[j]));
      count++;
    }
  }

  sims.sort((a, b) => a - b);
  const median = sims[Math.floor(sims.length / 2)];
  const mean = sims.reduce((a, b) => a + b, 0) / sims.length;
  const variance = sims.reduce((s, v) => s + (v - mean) ** 2, 0) / sims.length;
  const stddev = Math.sqrt(variance);

  return Math.max(0.65, Math.min(0.85, median - 0.8 * stddev));
}

/**
 * Greedy clustering by cosine similarity with adaptive threshold.
 * For each correction, assign to the best cluster above threshold,
 * or create a new cluster.
 */
function clusterCorrections(corrections, embeddings) {
  const threshold = computeAdaptiveThreshold(embeddings);
  const clusters = []; // { members: [idx], centroid: number[] }

  for (let i = 0; i < corrections.length; i++) {
    const emb = embeddings[i];
    let bestCluster = -1;
    let bestSim = 0;

    for (let c = 0; c < clusters.length; c++) {
      const sim = cosineSim(emb, clusters[c].centroid);
      if (sim > threshold && sim > bestSim) {
        bestCluster = c;
        bestSim = sim;
      }
    }

    if (bestCluster >= 0) {
      const cluster = clusters[bestCluster];
      cluster.members.push(i);
      const n = cluster.members.length;
      for (let d = 0; d < emb.length; d++) {
        cluster.centroid[d] = cluster.centroid[d] * ((n - 1) / n) + emb[d] / n;
      }
    } else {
      clusters.push({ members: [i], centroid: [...emb] });
    }
  }

  return { clusters, threshold };
}

/**
 * Synthesize a cluster of corrections into a single rule.
 * Typed synthesis: OPERATIONAL rules (numbers, constraints, formats) are preserved literally.
 * ABSTRACT rules (values, tone, attitude) are reformulated concisely.
 */
async function synthesizeCluster(anthropic, corrections) {
  const list = corrections.map(c => `- ${c.correction}`).join("\n");
  try {
    const result = await Promise.race([
      anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        system: `Tu consolides des corrections de style d'un clone vocal IA.

REGLE CRITIQUE DE CLASSIFICATION :
- Si les corrections contiennent des CHIFFRES, LONGUEURS, FORMATS, CONTRAINTES EXACTES, ou PATTERNS PRECIS (ex: "5-15 mots", "style WhatsApp", "tutoyer", "1 question par message", "pas de bloc")
  → c'est OPERATIONNEL. CONSERVE les chiffres et contraintes TELS QUELS dans ta synthese.
- Sinon → c'est ABSTRAIT (valeur, ton, attitude). Reformule en une regle concise.

NE JAMAIS abstraire une regle operationnelle. "5-15 mots max par message" ne doit JAMAIS devenir "sois concis".

Synthetise en UNE regle. Max 30 mots. Regle seule, pas d'explication.`,
        messages: [{ role: "user", content: `Corrections similaires :\n${list}` }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
    ]);
    return result.content[0].text.trim();
  } catch {
    // Fallback: use the most recent correction
    return corrections[corrections.length - 1].correction;
  }
}

/**
 * Run consolidation for a persona.
 * @param {string} personaId
 * @param {object} options
 * @returns {Promise<{ clustersFound: number, rulesPromoted: number, correctionsGraduated: number }>}
 */
export async function consolidateCorrections(personaId, { client = null } = {}) {
  const { data: persona } = await supabase
    .from("personas").select("*").eq("id", personaId).single();
  if (!persona) throw new Error("Persona not found");

  const intellId = getIntelligenceId(persona);

  // Load the intelligence SOURCE persona (may differ from triggering clone)
  // writingRules must be read from and written to the source so all clones share them
  const sourcePersona = intellId !== personaId
    ? (await supabase.from("personas").select("*").eq("id", intellId).single()).data
    : persona;
  if (!sourcePersona) throw new Error("Intelligence source persona not found");

  // Load active corrections
  const { data: corrections } = await supabase
    .from("corrections")
    .select("id, correction, confidence, created_at")
    .eq("persona_id", intellId)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (!corrections?.length || corrections.length < MIN_CLUSTER_SIZE) {
    return { clustersFound: 0, rulesPromoted: 0, correctionsGraduated: 0 };
  }

  // Embed all corrections
  const texts = corrections.map(c => c.correction);
  const embeddings = await embed(texts);
  if (!embeddings) return { clustersFound: 0, rulesPromoted: 0, correctionsGraduated: 0 };

  // Cluster (adaptive threshold)
  const { clusters, threshold } = clusterCorrections(corrections, embeddings);
  const promotable = clusters.filter(c => c.members.length >= MIN_CLUSTER_SIZE);

  if (promotable.length === 0) {
    return { clustersFound: clusters.length, rulesPromoted: 0, correctionsGraduated: 0, threshold };
  }

  const apiKey = getApiKey(client);
  const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

  // Snapshot fidelity BEFORE promoting any rules (for auto-backtest)
  let scoreBefore = null;
  try {
    scoreBefore = await calculateFidelityScore(personaId, { client });
  } catch { /* fidelity unavailable — backtest will be skipped */ }

  let rulesPromoted = 0;
  let correctionsGraduated = 0;
  const currentRules = [...(sourcePersona.voice?.writingRules || [])];

  const promotedRules = []; // track for potential auto-revert

  for (const cluster of promotable) {
    const clusterCorrs = cluster.members.map(i => corrections[i]);
    const synthesized = await synthesizeCluster(anthropic, clusterCorrs);

    // Check if a similar rule already exists
    const alreadyExists = currentRules.some(r =>
      r.toLowerCase().includes(synthesized.toLowerCase().slice(0, 20)) ||
      synthesized.toLowerCase().includes(r.toLowerCase().slice(0, 20))
    );
    if (alreadyExists) continue;

    // Add to writingRules
    currentRules.push(synthesized);
    promotedRules.push(synthesized);
    rulesPromoted++;

    // Graduate original corrections (store rule reference for rollback)
    const ids = clusterCorrs.map(c => c.id);
    const { error } = await supabase.from("corrections")
      .update({ status: "graduated", graduated_rule: synthesized })
      .in("id", ids);

    if (!error) correctionsGraduated += ids.length;
  }

  // Cap writingRules — evict oldest to prevent prompt overflow
  if (currentRules.length > MAX_WRITING_RULES) {
    currentRules.splice(0, currentRules.length - MAX_WRITING_RULES);
  }

  // Persist updated writingRules on the SOURCE persona (not the triggering clone)
  if (rulesPromoted > 0) {
    const updatedVoice = { ...sourcePersona.voice, writingRules: currentRules };
    await supabase.from("personas").update({ voice: updatedVoice }).eq("id", intellId);
    clearIntelligenceCache(intellId);
  }

  console.log(JSON.stringify({
    event: "consolidation_complete",
    ts: new Date().toISOString(),
    persona: personaId,
    clustersFound: clusters.length,
    promotable: promotable.length,
    rulesPromoted,
    correctionsGraduated,
    threshold,
  }));

  // Auto-backtest: compare fidelity before vs after promotion
  // If composite score drops significantly, auto-revert promoted rules
  let backtestResult = "skipped";
  if (rulesPromoted > 0) {
    try {
      const scoreAfter = await calculateFidelityScore(personaId, { client });
      if (scoreAfter && scoreBefore) {
        const delta = scoreAfter.score_global - scoreBefore.score_global;
        console.log(JSON.stringify({
          event: "consolidation_backtest",
          ts: new Date().toISOString(),
          persona: personaId,
          score_before: scoreBefore.score_global,
          score_after: scoreAfter.score_global,
          delta,
        }));

        if (delta < BACKTEST_REVERT_DELTA) {
          // Auto-revert all promoted rules
          for (const rule of promotedRules) {
            await revertConsolidation(personaId, rule);
          }
          clearIntelligenceCache(intellId);
          backtestResult = "auto-reverted";
          console.log(JSON.stringify({
            event: "consolidation_auto_reverted",
            ts: new Date().toISOString(),
            persona: personaId,
            delta,
            rulesReverted: rulesPromoted,
          }));
          return { clustersFound: clusters.length, rulesPromoted: 0, correctionsGraduated: 0, threshold, backtestResult };
        }
        backtestResult = "passed";
      } else {
        backtestResult = "incomplete";
      }
    } catch (err) {
      console.log(JSON.stringify({ event: "consolidation_backtest_error", error: err.message }));
      backtestResult = "error";
    }
  }

  return { clustersFound: clusters.length, rulesPromoted, correctionsGraduated, threshold, backtestResult };
}

/**
 * Revert a graduated rule: restore source corrections to active, remove rule from writingRules.
 * @param {string} personaId
 * @param {string} rule — exact text of the synthesized rule to revert
 */
export async function revertConsolidation(personaId, rule) {
  const { data: persona } = await supabase
    .from("personas").select("*").eq("id", personaId).single();
  if (!persona) throw new Error("Persona not found");

  const intellId = getIntelligenceId(persona);

  const { data: graduated } = await supabase
    .from("corrections")
    .select("id")
    .eq("persona_id", intellId)
    .eq("status", "graduated")
    .eq("graduated_rule", rule);

  if (!graduated?.length) return { reverted: 0 };

  const ids = graduated.map(c => c.id);
  await supabase.from("corrections")
    .update({ status: "active", graduated_rule: null })
    .in("id", ids);

  // Remove rule from writingRules
  const sourcePersona = intellId !== personaId
    ? (await supabase.from("personas").select("*").eq("id", intellId).single()).data
    : persona;

  if (sourcePersona?.voice?.writingRules) {
    const rules = sourcePersona.voice.writingRules.filter(r => r !== rule);
    await supabase.from("personas")
      .update({ voice: { ...sourcePersona.voice, writingRules: rules } })
      .eq("id", intellId);
  }

  clearIntelligenceCache(intellId);
  return { reverted: ids.length };
}

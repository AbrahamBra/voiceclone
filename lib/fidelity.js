/**
 * Fidelity score pipeline — main entry points.
 *
 * Math utilities → fidelity-math.js
 * Style metrics  → fidelity-style.js
 * This file: centroid cache, inline guard, calculateFidelityScore.
 *
 * Re-exports from sub-modules so existing import sites need no changes.
 */

import Anthropic from "@anthropic-ai/sdk";
import { supabase, getApiKey } from "./supabase.js";
import { embed, embedQuery, isEmbeddingAvailable } from "./embeddings.js";
import { log } from "./log.js";
import { buildSystemPrompt } from "./prompt.js";
import { loadPersonaData, getIntelligenceId } from "./knowledge-db.js";

import {
  cosineSim, clusterByTheme,
  extractLocalThemeLabel, rescaleScore,
} from "./fidelity-math.js";

import {
  computeStyleMetrics, styleScore, compositeScore,
  averageStyleMetrics, normalizedVarianceLoss, computeCollapseIndex,
} from "./fidelity-style.js";

// Re-export everything for backward compatibility (existing imports unchanged)
export {
  cosineSim, greedyCluster, clusterByTheme,
  extractLocalThemeLabel, rescaleScore,
  kmeansSelectRepresentatives, detectFidelityDecay,
} from "./fidelity-math.js";

export {
  computeStyleMetrics, compositeScore, computeCollapseIndex,
} from "./fidelity-style.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_CHUNKS = 3;
const MIN_CLUSTER_SIZE = 2;

// Persona centroid cache (1h TTL, separate from 5-min persona cache)
const _centroidCache = {};
const CENTROID_TTL = 60 * 60 * 1000;

// ─── Centroid (inline fidelity guard) ────────────────────────────────────────

/**
 * Get or compute the persona centroid (mean of all linkedin_post embeddings).
 * Cached for 1 hour.
 * @param {string} personaId
 * @returns {Promise<number[]|null>}
 */
export async function getPersonaCentroid(personaId) {
  const now = Date.now();
  if (_centroidCache[personaId] && now - _centroidCache[personaId].ts < CENTROID_TTL) {
    return _centroidCache[personaId].centroid;
  }

  const { data: persona } = await supabase
    .from("personas").select("id, intelligence_source_id").eq("id", personaId).single();
  if (!persona) return null;

  const intellId = getIntelligenceId(persona);
  const { data: rawChunks } = await supabase
    .from("chunks").select("embedding")
    .eq("persona_id", intellId).eq("source_type", "linkedin_post");

  if (!rawChunks || rawChunks.length < MIN_CHUNKS) return null;

  const embeddings = [];
  for (const chunk of rawChunks) {
    try {
      const parsed = typeof chunk.embedding === "string" ? JSON.parse(chunk.embedding) : chunk.embedding;
      if (Array.isArray(parsed) && parsed.length > 0) embeddings.push(parsed);
    } catch { /* skip */ }
  }
  if (embeddings.length < MIN_CHUNKS) return null;

  const dim = embeddings[0].length;
  const centroid = new Array(dim).fill(0);
  for (const emb of embeddings) {
    for (let d = 0; d < dim; d++) centroid[d] += emb[d];
  }
  for (let d = 0; d < dim; d++) centroid[d] /= embeddings.length;

  _centroidCache[personaId] = { ts: now, centroid };
  return centroid;
}

/**
 * Default drift threshold when neither caller nor persona overrides one.
 * 0.40 is conservative — only catches major thematic divergence. A persona
 * with shorter/noisier embeddings (WhatsApp-style 5-15 mots) may want to
 * raise it (0.55+); a persona on long-form posts where centroid is dense
 * may want to lower it.
 */
export const DEFAULT_FIDELITY_THRESHOLD = 0.40;

/**
 * Resolve the fidelity threshold for a persona/voice. Caller override wins,
 * then voice.fidelity_threshold from the DB, then DEFAULT_FIDELITY_THRESHOLD.
 * Values outside [0.10, 0.95] are ignored (clamped to default) — guards
 * against typos like 4.0 or -1 that would silently disable the guard.
 */
export function resolveFidelityThreshold({ override, voice } = {}) {
  const candidates = [override, voice?.fidelity_threshold];
  for (const v of candidates) {
    if (typeof v === "number" && v >= 0.10 && v <= 0.95) return v;
  }
  return DEFAULT_FIDELITY_THRESHOLD;
}

/**
 * Inline fidelity check: compare draft embedding vs persona centroid.
 * @param {string} personaId
 * @param {string} draftText
 * @param {{ threshold?: number, voice?: object }} [opts] - threshold override
 *   takes precedence; otherwise voice.fidelity_threshold; otherwise default.
 * @returns {Promise<{ similarity: number, threshold: number, drifted: boolean }|null>}
 */
export async function inlineFidelityCheck(personaId, draftText, opts = {}) {
  if (!isEmbeddingAvailable() || !draftText || draftText.length < 20) return null;

  const centroid = await getPersonaCentroid(personaId);
  if (!centroid) return null;

  const draftEmbedding = await embedQuery(draftText);
  if (!draftEmbedding) return null;

  const similarity = cosineSim(draftEmbedding, centroid);
  const threshold = resolveFidelityThreshold({
    override: opts.threshold,
    voice: opts.voice,
  });
  return { similarity, threshold, drifted: similarity < threshold };
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

/**
 * Calculate the fidelity score for a persona.
 * @param {string} personaId
 * @param {{ client?: object }} options
 * @returns {Promise<{ score_global: number, score_raw: number, scores_by_theme: object, theme_count: number, chunk_count: number, low_confidence: boolean } | null>}
 */
export async function calculateFidelityScore(personaId, { client = null } = {}) {
  if (!isEmbeddingAvailable()) return null;

  const { data: persona } = await supabase
    .from("personas").select("*").eq("id", personaId).single();
  if (!persona) return null;

  const intellId = getIntelligenceId(persona);

  const { data: rawChunks } = await supabase
    .from("chunks")
    .select("id, content, embedding")
    .eq("persona_id", intellId)
    .eq("source_type", "linkedin_post");

  if (!rawChunks || rawChunks.length < MIN_CHUNKS) return null;

  const chunks = [];
  const embeddings = [];
  for (const chunk of rawChunks) {
    try {
      const parsed = typeof chunk.embedding === "string"
        ? JSON.parse(chunk.embedding)
        : chunk.embedding;
      if (Array.isArray(parsed) && parsed.length > 0) {
        chunks.push(chunk);
        embeddings.push(parsed);
      }
    } catch {
      // Skip chunk with unparseable embedding
    }
  }

  if (chunks.length < MIN_CHUNKS) return null;

  const allClusters = clusterByTheme(embeddings);
  let validClusters = allClusters.filter(c => c.members.length >= MIN_CLUSTER_SIZE);
  let lowConfidence = false;

  if (validClusters.length < 2) {
    const largest = allClusters.reduce((a, b) => a.members.length >= b.members.length ? a : b);
    validClusters = [largest];
    lowConfidence = true;
  }

  const apiKey = getApiKey(client);
  const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

  const themeSummaries = validClusters.map((cluster, i) => {
    const samples = cluster.members.slice(0, 3).map(idx => chunks[idx].content.slice(0, 200));
    return `Theme ${i + 1}:\n${samples.join("\n---\n")}`;
  });

  let lines = [];
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const labelResult = await Promise.race([
        anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 200,
          system: "Label each theme in 2-4 words. Return one label per line, same order. No numbering, no explanation.",
          messages: [{ role: "user", content: themeSummaries.join("\n\n") }],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
      ]);
      lines = labelResult.content[0].text.trim().split("\n").filter(l => l.trim());
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (lastError) {
    console.log(JSON.stringify({ event: "fidelity_theme_label_failed", persona: personaId, cluster_count: validClusters.length, error: lastError.message }));
  }

  const themeLabels = validClusters.map((cluster, i) => {
    const haikuLabel = lines[i]?.trim();
    if (haikuLabel) return haikuLabel;
    const samples = cluster.members.slice(0, 5).map(idx => chunks[idx].content);
    return extractLocalThemeLabel(samples) || `Theme ${i + 1}`;
  });

  const personaData = await loadPersonaData(personaId);
  if (!personaData) return null;

  const voiceRules = personaData.persona.voice || {};

  const { prompt: systemPrompt } = buildSystemPrompt({
    persona: personaData.persona,
    knowledgeMatches: [],
    scenarioContent: null,
    corrections: null,
    ontology: { entities: personaData.entities, relations: personaData.relations },
  });

  const sourceTexts = chunks.map(c => c.content);
  const sourceMetrics = averageStyleMetrics(sourceTexts, voiceRules);

  const scoresByTheme = [];
  let weightedCosineSum = 0;
  let weightedCompositeSum = 0;
  let totalWeight = 0;
  const allDraftMetrics = [];
  const allDraftEmbeddings = [];

  for (let t = 0; t < validClusters.length; t++) {
    const cluster = validClusters[t];
    const label = themeLabels[t];
    const weight = cluster.members.length;

    const sampleTexts = cluster.members.slice(0, 3).map(idx => chunks[idx].content.slice(0, 300));
    const userPrompt = `Ecris un post LinkedIn sur le theme suivant, dans ton style habituel.\nTheme: ${label}\nExemples de posts existants sur ce theme:\n${sampleTexts.join("\n---\n")}\n\nEcris un nouveau post original sur ce theme.`;

    let themeCosine = 0;
    let themeComposite = 0;
    let draftMetrics = computeStyleMetrics("", voiceRules);

    try {
      const genResult = await Promise.race([
        anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 500,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
      ]);

      const generatedText = genResult.content[0].text;
      draftMetrics = computeStyleMetrics(generatedText, voiceRules);
      allDraftMetrics.push(draftMetrics);

      const genEmbedding = await embed([generatedText]);
      if (genEmbedding && genEmbedding[0]) {
        themeCosine = cosineSim(genEmbedding[0], cluster.centroid);
        allDraftEmbeddings.push(genEmbedding[0]);
      }

      themeComposite = compositeScore(themeCosine, sourceMetrics, draftMetrics);
    } catch {
      // Generation or embedding failed for this theme
    }

    scoresByTheme.push({
      theme: label,
      score: Math.round(themeComposite),
      score_cosine: rescaleScore(themeCosine),
      score_raw: themeCosine,
      style_metrics: draftMetrics,
      chunk_count: cluster.members.length,
    });

    weightedCosineSum += themeCosine * weight;
    weightedCompositeSum += themeComposite * weight;
    totalWeight += weight;
  }

  const rawCosine = totalWeight > 0 ? weightedCosineSum / totalWeight : 0;
  const globalComposite = totalWeight > 0 ? weightedCompositeSum / totalWeight : 0;

  // Averaged draft metrics for collapse computation
  const avgDraftMetrics = allDraftMetrics.length > 0 ? averageStyleMetrics([], voiceRules) : sourceMetrics;
  if (allDraftMetrics.length > 0) {
    const n = allDraftMetrics.length;
    const avg = (key) => allDraftMetrics.reduce((s, m) => s + m[key], 0) / n;
    avgDraftMetrics.avgSentenceLen = avg("avgSentenceLen");
    avgDraftMetrics.sentenceLenStd = avg("sentenceLenStd");
    avgDraftMetrics.kurtosis = avg("kurtosis");
    avgDraftMetrics.sentenceLenEntropy = avg("sentenceLenEntropy");
    avgDraftMetrics.questionRatio = avg("questionRatio");
    avgDraftMetrics.questionPlacementVar = avg("questionPlacementVar");
    avgDraftMetrics.ttr = avg("ttr");
    avgDraftMetrics.signaturePresence = avg("signaturePresence");
    avgDraftMetrics.forbiddenHits = Math.max(...allDraftMetrics.map(m => m.forbiddenHits || 0));
  }

  const styleSc = styleScore(sourceMetrics, avgDraftMetrics);
  const varianceLoss = normalizedVarianceLoss(sourceMetrics, avgDraftMetrics);

  let embeddingVariance = null;
  if (allDraftEmbeddings.length >= 1) {
    const sourceCentroid = await getPersonaCentroid(personaId);
    if (sourceCentroid) {
      const distances = allDraftEmbeddings.map(e => cosineSim(e, sourceCentroid));
      const meanDist = distances.reduce((a, b) => a + b, 0) / distances.length;
      embeddingVariance = Math.round(meanDist * 1000) / 1000;
    }
  }

  const collapseIndex = computeCollapseIndex(styleSc, varianceLoss, avgDraftMetrics.ttr, sourceMetrics.ttr, embeddingVariance);

  const result = {
    score_global: Math.round(globalComposite),
    score_cosine: rescaleScore(rawCosine),
    score_raw: rawCosine,
    scores_by_theme: scoresByTheme,
    theme_count: validClusters.length,
    chunk_count: chunks.length,
    low_confidence: lowConfidence,
    source_style: sourceMetrics,
    draft_style: avgDraftMetrics,
    collapse_index: collapseIndex,
    embedding_variance: embeddingVariance,
    variance_loss: Math.round(varianceLoss * 1000) / 1000,
  };

  await supabase.from("fidelity_scores").insert({ persona_id: personaId, ...result });

  log("fidelity_score_calculated", {
    persona: personaId,
    score_global: result.score_global,
    score_cosine: result.score_cosine,
    score_raw: rawCosine,
    collapse_index: collapseIndex,
    embedding_variance: embeddingVariance,
    variance_loss: result.variance_loss,
    theme_count: validClusters.length,
    chunk_count: chunks.length,
    low_confidence: lowConfidence,
  });

  return result;
}

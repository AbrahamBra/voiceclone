/**
 * Fidelity score: measures how well a clone reproduces the original human's style.
 *
 * Shared utilities (cosineSim, clusterByTheme, rescaleScore) + composite scoring
 * (70% cosine thematic + 30% style metrics) + inline fidelity guard.
 */

import Anthropic from "@anthropic-ai/sdk";
import { supabase, getApiKey } from "./supabase.js";
import { embed, embedQuery, isEmbeddingAvailable } from "./embeddings.js";
import { buildSystemPrompt } from "./prompt.js";
import { loadPersonaData, getIntelligenceId } from "./knowledge-db.js";

const MIN_CHUNKS = 3;
const MIN_CLUSTER_SIZE = 2;

// --- Persona centroid cache (1h TTL, separate from 5-min persona cache) ---
const _centroidCache = {};
const CENTROID_TTL = 60 * 60 * 1000;

// --- Shared utilities ---

/**
 * Cosine similarity between two vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function cosineSim(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Greedy clustering by cosine similarity against centroids.
 * @param {number[][]} embeddings
 * @param {number} threshold
 * @returns {{ members: number[], centroid: number[] }[]}
 */
export function clusterByTheme(embeddings, threshold = 0.70) {
  const clusters = [];

  for (let i = 0; i < embeddings.length; i++) {
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

  return clusters;
}

/**
 * Rescale a raw similarity score from [0.35, 0.90] to [0, 100].
 * @param {number} raw
 * @returns {number}
 */
export function rescaleScore(raw) {
  const clamped = Math.max(0.35, Math.min(0.90, raw));
  return Math.round(((clamped - 0.35) / (0.90 - 0.35)) * 100);
}

// --- Style metrics ---

/**
 * Extract quantitative style metrics from a text.
 * @param {string} text
 * @param {object} voiceRules - { signaturePhrases, forbiddenWords }
 * @returns {{ avgSentenceLen: number, questionRatio: number, signaturePresence: number, forbiddenHits: number }}
 */
export function computeStyleMetrics(text, voiceRules = {}) {
  const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 0);
  if (sentences.length === 0) return { avgSentenceLen: 0, questionRatio: 0, signaturePresence: 0, forbiddenHits: 0 };

  const wordCounts = sentences.map(s => s.split(/\s+/).length);
  const avgSentenceLen = wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;

  const questions = text.split(/\n+/).filter(l => l.trim().endsWith("?"));
  const questionRatio = questions.length / Math.max(sentences.length, 1);

  let signaturePresence = 0;
  if (voiceRules.signaturePhrases?.length) {
    const lower = text.toLowerCase();
    const found = voiceRules.signaturePhrases.filter(p => lower.includes(p.toLowerCase())).length;
    signaturePresence = found / voiceRules.signaturePhrases.length;
  }

  let forbiddenHits = 0;
  if (voiceRules.forbiddenWords?.length) {
    const lower = text.toLowerCase();
    for (const w of voiceRules.forbiddenWords) {
      if (w && lower.includes(w.toLowerCase())) forbiddenHits++;
    }
  }

  return { avgSentenceLen, questionRatio, signaturePresence, forbiddenHits };
}

/**
 * Compute style similarity between source metrics and draft metrics.
 * Returns a score in [0, 1].
 */
function styleScore(sourceMetrics, draftMetrics) {
  // Sentence length similarity (30%)
  const lenSim = sourceMetrics.avgSentenceLen > 0
    ? Math.max(0, 1 - Math.abs(sourceMetrics.avgSentenceLen - draftMetrics.avgSentenceLen) / sourceMetrics.avgSentenceLen)
    : 1;

  // Question ratio similarity (25%)
  const qSim = 1 - Math.abs(sourceMetrics.questionRatio - draftMetrics.questionRatio);

  // Signature presence in draft (25%)
  const sigScore = draftMetrics.signaturePresence;

  // Forbidden words clean (20%)
  const forbiddenClean = draftMetrics.forbiddenHits === 0 ? 1.0 : 0.0;

  return 0.30 * lenSim + 0.25 * qSim + 0.25 * sigScore + 0.20 * forbiddenClean;
}

/**
 * Compute composite fidelity score: 70% cosine + 30% style metrics.
 */
export function compositeScore(cosineSim, sourceMetrics, draftMetrics) {
  const style = styleScore(sourceMetrics, draftMetrics);
  return 0.70 * rescaleScore(cosineSim) + 0.30 * (style * 100);
}

/**
 * Compute average style metrics across multiple source texts.
 */
function averageStyleMetrics(texts, voiceRules) {
  if (texts.length === 0) return { avgSentenceLen: 0, questionRatio: 0, signaturePresence: 0, forbiddenHits: 0 };
  const all = texts.map(t => computeStyleMetrics(t, voiceRules));
  const n = all.length;
  return {
    avgSentenceLen: all.reduce((s, m) => s + m.avgSentenceLen, 0) / n,
    questionRatio: all.reduce((s, m) => s + m.questionRatio, 0) / n,
    signaturePresence: all.reduce((s, m) => s + m.signaturePresence, 0) / n,
    forbiddenHits: 0, // source should have 0
  };
}

// --- Persona centroid (for inline fidelity guard) ---

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

  // Mean centroid
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
 * Inline fidelity check: compare draft embedding vs persona centroid.
 * Returns similarity score or null if unavailable.
 * @param {string} personaId
 * @param {string} draftText
 * @returns {Promise<{ similarity: number, threshold: number, drifted: boolean }|null>}
 */
export async function inlineFidelityCheck(personaId, draftText) {
  if (!isEmbeddingAvailable() || !draftText || draftText.length < 20) return null;

  const centroid = await getPersonaCentroid(personaId);
  if (!centroid) return null;

  const draftEmbedding = await embedQuery(draftText);
  if (!draftEmbedding) return null;

  const similarity = cosineSim(draftEmbedding, centroid);
  // Adaptive threshold: use 0.40 (generous) — this is a drift detector, not a quality gate
  const threshold = 0.40;
  return { similarity, threshold, drifted: similarity < threshold };
}

// --- Main pipeline ---

/**
 * Calculate the fidelity score for a persona.
 * @param {string} personaId
 * @param {{ client?: object }} options
 * @returns {Promise<{ score_global: number, score_raw: number, scores_by_theme: object, theme_count: number, chunk_count: number, low_confidence: boolean } | null>}
 */
export async function calculateFidelityScore(personaId, { client = null } = {}) {
  if (!isEmbeddingAvailable()) return null;

  // 1. Load chunks from DB (linkedin_post source_type)
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

  // 2. Parse embeddings (PostgREST returns vector as string)
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

  // 3. Cluster by theme
  const allClusters = clusterByTheme(embeddings);
  let validClusters = allClusters.filter(c => c.members.length >= MIN_CLUSTER_SIZE);
  let lowConfidence = false;

  if (validClusters.length < 2) {
    // Use largest cluster, mark low confidence
    const largest = allClusters.reduce((a, b) => a.members.length >= b.members.length ? a : b);
    validClusters = [largest];
    lowConfidence = true;
  }

  // 4. Label themes via single Haiku call
  const apiKey = getApiKey(client);
  const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

  const themeSummaries = validClusters.map((cluster, i) => {
    const samples = cluster.members.slice(0, 3).map(idx => chunks[idx].content.slice(0, 200));
    return `Theme ${i + 1}:\n${samples.join("\n---\n")}`;
  });

  let themeLabels;
  try {
    const labelResult = await Promise.race([
      anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system: "Label each theme in 2-4 words. Return one label per line, same order. No numbering, no explanation.",
        messages: [{ role: "user", content: themeSummaries.join("\n\n") }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
    ]);
    const lines = labelResult.content[0].text.trim().split("\n").filter(l => l.trim());
    themeLabels = validClusters.map((_, i) => lines[i]?.trim() || `Theme ${i + 1}`);
  } catch {
    themeLabels = validClusters.map((_, i) => `Theme ${i + 1}`);
  }

  // 5. For each theme: generate clone text, embed, compare vs centroid + style metrics
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

  // Pre-compute source style metrics (averaged across all source chunks)
  const sourceTexts = chunks.map(c => c.content);
  const sourceMetrics = averageStyleMetrics(sourceTexts, voiceRules);

  const scoresByTheme = [];
  let weightedCosineSum = 0;
  let weightedCompositeSum = 0;
  let totalWeight = 0;
  const draftSentenceLengths = []; // for style variance tracking

  for (let t = 0; t < validClusters.length; t++) {
    const cluster = validClusters[t];
    const label = themeLabels[t];
    const weight = cluster.members.length;

    const sampleTexts = cluster.members.slice(0, 3).map(idx => chunks[idx].content.slice(0, 300));
    const userPrompt = `Ecris un post LinkedIn sur le theme suivant, dans ton style habituel.\nTheme: ${label}\nExemples de posts existants sur ce theme:\n${sampleTexts.join("\n---\n")}\n\nEcris un nouveau post original sur ce theme.`;

    let themeCosine = 0;
    let themeComposite = 0;
    let draftMetrics = { avgSentenceLen: 0, questionRatio: 0, signaturePresence: 0, forbiddenHits: 0 };

    try {
      const genResult = await Promise.race([
        anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 500,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
      ]);

      const generatedText = genResult.content[0].text;
      draftMetrics = computeStyleMetrics(generatedText, voiceRules);
      draftSentenceLengths.push(draftMetrics.avgSentenceLen);

      const genEmbedding = await embed([generatedText]);
      if (genEmbedding && genEmbedding[0]) {
        themeCosine = cosineSim(genEmbedding[0], cluster.centroid);
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

  // Style variance: std of draft sentence lengths vs source (collapse detector)
  let styleVariance = null;
  if (draftSentenceLengths.length >= 2) {
    const mean = draftSentenceLengths.reduce((a, b) => a + b, 0) / draftSentenceLengths.length;
    const variance = draftSentenceLengths.reduce((s, v) => s + (v - mean) ** 2, 0) / draftSentenceLengths.length;
    styleVariance = Math.round(Math.sqrt(variance) * 100) / 100;
  }

  const result = {
    score_global: Math.round(globalComposite),
    score_cosine: rescaleScore(rawCosine),
    score_raw: rawCosine,
    scores_by_theme: scoresByTheme,
    theme_count: validClusters.length,
    chunk_count: chunks.length,
    low_confidence: lowConfidence,
    source_style: sourceMetrics,
    style_variance: styleVariance,
  };

  // 6. Insert into fidelity_scores
  await supabase.from("fidelity_scores").insert({
    persona_id: personaId,
    ...result,
  });

  console.log(JSON.stringify({
    event: "fidelity_score_calculated",
    ts: new Date().toISOString(),
    persona: personaId,
    score_global: result.score_global,
    score_cosine: result.score_cosine,
    score_raw: rawCosine,
    style_variance: styleVariance,
    theme_count: validClusters.length,
    chunk_count: chunks.length,
    low_confidence: lowConfidence,
  }));

  return result;
}

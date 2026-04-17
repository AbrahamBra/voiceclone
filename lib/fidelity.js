/**
 * Fidelity score: measures how well a clone reproduces the original human's style.
 *
 * Shared utilities (cosineSim, clusterByTheme, rescaleScore) + composite scoring
 * (70% cosine thematic + 30% style metrics) + inline fidelity guard.
 */

import Anthropic from "@anthropic-ai/sdk";
import { supabase, getApiKey } from "./supabase.js";
import { embed, embedQuery, isEmbeddingAvailable } from "./embeddings.js";
import { log } from "./log.js";
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
 * Greedy clustering by cosine similarity against centroids with online centroid drift.
 * Shared primitive used by both theme clustering (fidelity) and correction clustering.
 * @param {number[][]} embeddings
 * @param {number} threshold - similarity above which an embedding joins an existing cluster
 * @returns {{ members: number[], centroid: number[] }[]}
 */
export function greedyCluster(embeddings, threshold) {
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
 * Theme clustering with a fixed similarity threshold (0.70 default).
 * Thin wrapper over greedyCluster preserved for existing call-sites.
 * @param {number[][]} embeddings
 * @param {number} threshold
 * @returns {{ members: number[], centroid: number[] }[]}
 */
export function clusterByTheme(embeddings, threshold = 0.70) {
  return greedyCluster(embeddings, threshold);
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
 * Includes collapse-detection dimensions: kurtosis, lexical diversity (TTR),
 * question placement variance.
 * @param {string} text
 * @param {object} voiceRules - { signaturePhrases, forbiddenWords }
 */
export function computeStyleMetrics(text, voiceRules = {}) {
  const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 0);
  if (sentences.length === 0) {
    return { avgSentenceLen: 0, sentenceLenStd: 0, kurtosis: 0, sentenceLenEntropy: 0,
      questionRatio: 0, questionPlacementVar: 0, ttr: 0, signaturePresence: 0, forbiddenHits: 0 };
  }

  // Sentence length stats
  const wordCounts = sentences.map(s => s.split(/\s+/).length);
  const n = wordCounts.length;
  const avgSentenceLen = wordCounts.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? wordCounts.reduce((s, v) => s + (v - avgSentenceLen) ** 2, 0) / n : 0;
  const sentenceLenStd = Math.sqrt(variance);

  // Kurtosis: kept for backward compatibility with historical fidelity_scores rows.
  // On short heterogeneous French text it often sits near 0 and doesn't discriminate.
  let kurtosis = 0;
  if (n >= 4 && sentenceLenStd > 0) {
    const m4 = wordCounts.reduce((s, v) => s + ((v - avgSentenceLen) / sentenceLenStd) ** 4, 0) / n;
    kurtosis = m4 - 3; // excess kurtosis
  }

  // Shannon entropy of sentence-length distribution — our primary anti-uniformization
  // signal. When a clone flattens out (all sentences ~15 words), this drops sharply
  // even when kurtosis stays near 0. Binned into 4 length buckets, normalized to [0, 1].
  // Perfectly uniform across buckets = 1.0 (healthy variety). All in one bucket = 0.
  let sentenceLenEntropy = 0;
  if (n >= 2) {
    // Bins: very short (1-5), short (6-10), medium (11-18), long (19+) words
    const bins = [0, 0, 0, 0];
    for (const w of wordCounts) {
      if (w <= 5) bins[0]++;
      else if (w <= 10) bins[1]++;
      else if (w <= 18) bins[2]++;
      else bins[3]++;
    }
    let h = 0;
    for (const b of bins) {
      if (b > 0) {
        const p = b / n;
        h -= p * Math.log2(p);
      }
    }
    // log2(4) = 2 is the max entropy (uniform across 4 bins). Normalize to [0, 1].
    sentenceLenEntropy = h / 2;
  }

  // Question ratio + placement variance
  const lines = text.split(/\n+/).filter(l => l.trim().length > 0);
  const questionPositions = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().endsWith("?")) questionPositions.push(i / Math.max(lines.length - 1, 1));
  }
  const questionRatio = questionPositions.length / Math.max(lines.length, 1);

  // Variance of question placement (0 = always same spot, high = spread out)
  let questionPlacementVar = 0;
  if (questionPositions.length >= 2) {
    const qMean = questionPositions.reduce((a, b) => a + b, 0) / questionPositions.length;
    questionPlacementVar = questionPositions.reduce((s, v) => s + (v - qMean) ** 2, 0) / questionPositions.length;
  }

  // Lexical diversity: Type-Token Ratio on an ADAPTIVE tail window.
  // Fixed 200-token windows caused near-perfect TTR on short French posts
  // (~80 words), masking real vocabulary collapse. The adaptive window uses
  // min(200, 40% of total) — large texts stay capped at 200 to bound noise;
  // short texts get a proportional window that actually reveals drift.
  const allWords = text.toLowerCase().replace(/[^a-zàâéèêëïîôùûüç\s'-]/g, "").split(/\s+/).filter(w => w.length > 1);
  const windowSize = Math.max(10, Math.min(200, Math.ceil(allWords.length * 0.4)));
  const window = allWords.slice(-windowSize);
  const ttr = window.length > 0 ? new Set(window).size / window.length : 0;

  // Signature presence
  let signaturePresence = 0;
  if (voiceRules.signaturePhrases?.length) {
    const lower = text.toLowerCase();
    const found = voiceRules.signaturePhrases.filter(p => lower.includes(p.toLowerCase())).length;
    signaturePresence = found / voiceRules.signaturePhrases.length;
  }

  // Forbidden words
  let forbiddenHits = 0;
  if (voiceRules.forbiddenWords?.length) {
    const lower = text.toLowerCase();
    for (const w of voiceRules.forbiddenWords) {
      if (w && lower.includes(w.toLowerCase())) forbiddenHits++;
    }
  }

  return { avgSentenceLen, sentenceLenStd, kurtosis, sentenceLenEntropy,
    questionRatio, questionPlacementVar, ttr, signaturePresence, forbiddenHits };
}

/**
 * Compute style similarity between source metrics and draft metrics.
 * Returns a score in [0, 1].
 * Covers structural (length, kurtosis), behavioral (questions, signatures),
 * and lexical (TTR, forbidden) dimensions.
 */
function styleScore(sourceMetrics, draftMetrics) {
  // Sentence length similarity (18%)
  const lenSim = sourceMetrics.avgSentenceLen > 0
    ? Math.max(0, 1 - Math.abs(sourceMetrics.avgSentenceLen - draftMetrics.avgSentenceLen) / sourceMetrics.avgSentenceLen)
    : 1;

  // Kurtosis similarity (5%) — weak signal on French short-form, kept for continuity.
  // Guard against div-by-zero when sourceMetrics.kurtosis ≈ 0 (common).
  const kurtSim = Math.max(0, 1 - Math.abs(sourceMetrics.kurtosis - draftMetrics.kurtosis) / Math.max(Math.abs(sourceMetrics.kurtosis), 1));

  // Sentence-length entropy similarity (12%) — PRIMARY anti-uniformization signal.
  // Detects clones flattening to a single sentence-length band even when kurtosis=0.
  // Both values live in [0, 1] so absolute diff is the natural metric.
  const entropySim = 1 - Math.abs(sourceMetrics.sentenceLenEntropy - draftMetrics.sentenceLenEntropy);

  // Question ratio similarity (12%)
  const qSim = 1 - Math.abs(sourceMetrics.questionRatio - draftMetrics.questionRatio);

  // Question placement similarity (3%) — often undefined on short posts
  const qpSim = Math.max(0, 1 - Math.abs(sourceMetrics.questionPlacementVar - draftMetrics.questionPlacementVar) / Math.max(sourceMetrics.questionPlacementVar, 0.01));

  // Lexical diversity similarity (18%) — now meaningful thanks to adaptive window
  const ttrSim = sourceMetrics.ttr > 0
    ? Math.max(0, 1 - Math.abs(sourceMetrics.ttr - draftMetrics.ttr) / sourceMetrics.ttr)
    : 1;

  // Signature presence in draft (18%)
  const sigScore = draftMetrics.signaturePresence;

  // Forbidden words clean (14%) — strict binary gate
  const forbiddenClean = draftMetrics.forbiddenHits === 0 ? 1.0 : 0.0;

  return 0.18 * lenSim + 0.05 * kurtSim + 0.12 * entropySim + 0.12 * qSim + 0.03 * qpSim
       + 0.18 * ttrSim + 0.18 * sigScore + 0.14 * forbiddenClean;
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
  const zero = { avgSentenceLen: 0, sentenceLenStd: 0, kurtosis: 0, sentenceLenEntropy: 0,
    questionRatio: 0, questionPlacementVar: 0, ttr: 0, signaturePresence: 0, forbiddenHits: 0 };
  if (texts.length === 0) return zero;
  const all = texts.map(t => computeStyleMetrics(t, voiceRules));
  const n = all.length;
  const avg = (key) => all.reduce((s, m) => s + m[key], 0) / n;
  // Note: forbiddenHits is a PRESENCE signal — any source text with a hit
  // poisons the average. We keep it at 0 for the aggregate source baseline
  // (source is assumed clean by definition) and report it as a max across
  // drafts when needed at call-site.
  return {
    avgSentenceLen: avg("avgSentenceLen"),
    sentenceLenStd: avg("sentenceLenStd"),
    kurtosis: avg("kurtosis"),
    sentenceLenEntropy: avg("sentenceLenEntropy"),
    questionRatio: avg("questionRatio"),
    questionPlacementVar: avg("questionPlacementVar"),
    ttr: avg("ttr"),
    signaturePresence: avg("signaturePresence"),
    forbiddenHits: 0,
  };
}

/**
 * Normalized variance loss: measures how far draft metrics drifted from source.
 * Per-dimension relative distance, averaged. Returns [0, 1] where 0 = identical, 1 = max drift.
 */
function normalizedVarianceLoss(sourceMetrics, draftMetrics) {
  // sentenceLenEntropy lives in [0,1] so we handle it separately (no relative denom).
  const relativeDims = ["sentenceLenStd", "kurtosis", "questionPlacementVar", "ttr"];
  let totalLoss = 0;
  let count = 0;
  for (const key of relativeDims) {
    const src = sourceMetrics[key] ?? 0;
    const draft = draftMetrics[key] ?? 0;
    const denom = Math.max(Math.abs(src), 0.01);
    totalLoss += Math.min(Math.abs(src - draft) / denom, 1.0);
    count++;
  }
  // Entropy is already bounded — use absolute diff
  totalLoss += Math.abs((sourceMetrics.sentenceLenEntropy ?? 0) - (draftMetrics.sentenceLenEntropy ?? 0));
  count++;
  return count > 0 ? totalLoss / count : 0;
}

/**
 * Compute collapse index: multi-dimensional style preservation score.
 * Higher = better preserved. Range [0, 100].
 *
 * Formula: 0.40 * styleScore + 0.35 * (1 - varianceLoss) + 0.25 * lexicalDiversityRatio
 *
 * @param {number} styleSc - styleScore result [0, 1]
 * @param {number} varianceLoss - normalizedVarianceLoss result [0, 1]
 * @param {number} draftTTR - draft lexical diversity
 * @param {number} sourceTTR - source lexical diversity
 * @param {number|null} embeddingVariance - std of pairwise similarities between draft embeddings (null if unavailable)
 * @returns {number} collapse index [0, 100]
 */
export function computeCollapseIndex(styleSc, varianceLoss, draftTTR, sourceTTR, embeddingVariance = null) {
  const ttrRatio = sourceTTR > 0 ? Math.min(draftTTR / sourceTTR, 1.0) : 1;

  let base = 0.40 * styleSc + 0.35 * (1 - varianceLoss) + 0.25 * ttrRatio;

  // If embeddingVariance is available, it is now the MEAN COSINE between each
  // draft and the persona source centroid (see calculateFidelityScore).
  // High = drafts close to source = healthy. We rescale the typical healthy
  // band [0.40, 0.85] to [0, 1]; below 0.40 the clone has drifted semantically.
  if (embeddingVariance !== null) {
    const driftProximity = Math.max(0, Math.min(1, (embeddingVariance - 0.40) / (0.85 - 0.40)));
    base = 0.35 * styleSc + 0.25 * (1 - varianceLoss) + 0.20 * ttrRatio + 0.20 * driftProximity;
  }

  return Math.round(base * 100);
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
          model: "claude-sonnet-4-20250514",
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

  // --- Collapse index computation ---

  // Averaged draft metrics for collapse comparison
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
    // forbiddenHits stays as a presence flag across drafts: max > 0 => clone leaked
    avgDraftMetrics.forbiddenHits = Math.max(...allDraftMetrics.map(m => m.forbiddenHits || 0));
  }

  const styleSc = styleScore(sourceMetrics, avgDraftMetrics);
  const varianceLoss = normalizedVarianceLoss(sourceMetrics, avgDraftMetrics);

  // Embedding drift: mean distance from each draft to the SOURCE centroid.
  // Replaces the old pairwise-between-drafts variance, which couldn't distinguish
  // "drafts diverse among themselves" from "drafts collectively drifted away
  // from source". Higher value = drafts closer to source persona = healthier.
  // Kept under the same key `embedding_variance` for DB/schema compatibility.
  let embeddingVariance = null;
  if (allDraftEmbeddings.length >= 1) {
    const sourceCentroid = await getPersonaCentroid(personaId);
    if (sourceCentroid) {
      const distances = allDraftEmbeddings.map(e => cosineSim(e, sourceCentroid));
      const meanDist = distances.reduce((a, b) => a + b, 0) / distances.length;
      // meanDist is in [-1, 1] but realistically [0.3, 0.95]. Store raw value.
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

  // 6. Insert into fidelity_scores
  await supabase.from("fidelity_scores").insert({
    persona_id: personaId,
    ...result,
  });

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

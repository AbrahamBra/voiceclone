/**
 * Fidelity score: measures how well a clone reproduces the original human's style.
 *
 * Shared utilities (cosineSim, clusterByTheme, rescaleScore) + main pipeline.
 */

import Anthropic from "@anthropic-ai/sdk";
import { supabase, getApiKey } from "./supabase.js";
import { embed, isEmbeddingAvailable } from "./embeddings.js";
import { buildSystemPrompt } from "./prompt.js";
import { loadPersonaData, getIntelligenceId } from "./knowledge-db.js";

const MIN_CHUNKS = 3;
const MIN_CLUSTER_SIZE = 2;

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

  // 5. For each theme: generate clone text, embed, compare vs centroid
  const personaData = await loadPersonaData(personaId);
  if (!personaData) return null;

  const { prompt: systemPrompt } = buildSystemPrompt({
    persona: personaData.persona,
    knowledgeMatches: [],
    scenarioContent: null,
    corrections: null,
    ontology: { entities: personaData.entities, relations: personaData.relations },
  });

  const scoresByTheme = [];
  let weightedSum = 0;
  let totalWeight = 0;

  for (let t = 0; t < validClusters.length; t++) {
    const cluster = validClusters[t];
    const label = themeLabels[t];
    const weight = cluster.members.length;

    // Pick representative samples for the generation prompt
    const sampleTexts = cluster.members.slice(0, 3).map(idx => chunks[idx].content.slice(0, 300));
    const userPrompt = `Ecris un post LinkedIn sur le theme suivant, dans ton style habituel.\nTheme: ${label}\nExemples de posts existants sur ce theme:\n${sampleTexts.join("\n---\n")}\n\nEcris un nouveau post original sur ce theme.`;

    let themeSim = 0;
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

      // Embed with input_type="document" (symmetric comparison)
      const genEmbedding = await embed([generatedText]);
      if (genEmbedding && genEmbedding[0]) {
        themeSim = cosineSim(genEmbedding[0], cluster.centroid);
      }
    } catch {
      // Generation or embedding failed for this theme, score stays 0
    }

    scoresByTheme.push({
      theme: label,
      score: rescaleScore(themeSim),
      score_raw: themeSim,
      chunk_count: cluster.members.length,
    });

    weightedSum += themeSim * weight;
    totalWeight += weight;
  }

  const rawGlobal = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const scoreGlobal = rescaleScore(rawGlobal);

  const result = {
    score_global: scoreGlobal,
    score_raw: rawGlobal,
    scores_by_theme: scoresByTheme,
    theme_count: validClusters.length,
    chunk_count: chunks.length,
    low_confidence: lowConfidence,
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
    score_global: scoreGlobal,
    score_raw: rawGlobal,
    theme_count: validClusters.length,
    chunk_count: chunks.length,
    low_confidence: lowConfidence,
  }));

  return result;
}

/**
 * Correction consolidation via embeddings.
 *
 * Pipeline:
 * 1. Embed all active corrections via Voyage
 * 2. Cluster by cosine similarity (threshold 0.75)
 * 3. Synthesize each cluster (3+ members) into an abstract rule via Haiku
 * 4. Promote synthesized rules to persona.voice.writingRules
 * 5. Mark original corrections as status: "graduated"
 *
 * Run periodically (after every 10th correction, or daily cron).
 */

import Anthropic from "@anthropic-ai/sdk";
import { supabase, getApiKey } from "./supabase.js";
import { embed } from "./embeddings.js";
import { clearIntelligenceCache, getIntelligenceId } from "./knowledge-db.js";

const MIN_CLUSTER_SIZE = 3;
const SIMILARITY_THRESHOLD = 0.75;

/**
 * Cosine similarity between two vectors.
 */
function cosineSim(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Simple greedy clustering by cosine similarity.
 * For each correction, assign to the first cluster with avg similarity > threshold,
 * or create a new cluster.
 */
function clusterCorrections(corrections, embeddings) {
  const clusters = []; // { members: [idx], centroid: number[] }

  for (let i = 0; i < corrections.length; i++) {
    const emb = embeddings[i];
    let bestCluster = -1;
    let bestSim = 0;

    for (let c = 0; c < clusters.length; c++) {
      const sim = cosineSim(emb, clusters[c].centroid);
      if (sim > SIMILARITY_THRESHOLD && sim > bestSim) {
        bestCluster = c;
        bestSim = sim;
      }
    }

    if (bestCluster >= 0) {
      const cluster = clusters[bestCluster];
      cluster.members.push(i);
      // Update centroid (running average)
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
 * Synthesize a cluster of corrections into a single abstract rule.
 */
async function synthesizeCluster(anthropic, corrections) {
  const list = corrections.map(c => `- ${c.correction}`).join("\n");
  try {
    const result = await Promise.race([
      anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        system: `Tu consolides des corrections de style d'un clone vocal IA.
Plusieurs corrections similaires expriment la meme idee. Synthetise-les en UNE regle concise et actionnable.
Reponds avec la regle seule, pas de JSON, pas d'explication. Max 30 mots.`,
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

  // Cluster
  const clusters = clusterCorrections(corrections, embeddings);
  const promotable = clusters.filter(c => c.members.length >= MIN_CLUSTER_SIZE);

  if (promotable.length === 0) {
    return { clustersFound: clusters.length, rulesPromoted: 0, correctionsGraduated: 0 };
  }

  const apiKey = getApiKey(client);
  const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

  let rulesPromoted = 0;
  let correctionsGraduated = 0;
  const currentRules = [...(persona.voice?.writingRules || [])];

  for (const cluster of promotable) {
    const clusterCorrections = cluster.members.map(i => corrections[i]);
    const synthesized = await synthesizeCluster(anthropic, clusterCorrections);

    // Check if a similar rule already exists
    const alreadyExists = currentRules.some(r =>
      r.toLowerCase().includes(synthesized.toLowerCase().slice(0, 20)) ||
      synthesized.toLowerCase().includes(r.toLowerCase().slice(0, 20))
    );
    if (alreadyExists) continue;

    // Add to writingRules
    currentRules.push(synthesized);
    rulesPromoted++;

    // Graduate original corrections
    const ids = clusterCorrections.map(c => c.id);
    const { error } = await supabase.from("corrections")
      .update({ status: "graduated" })
      .in("id", ids);

    if (!error) correctionsGraduated += ids.length;
  }

  // Persist updated writingRules
  if (rulesPromoted > 0) {
    const updatedVoice = { ...persona.voice, writingRules: currentRules };
    await supabase.from("personas").update({ voice: updatedVoice }).eq("id", personaId);
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
  }));

  return { clustersFound: clusters.length, rulesPromoted, correctionsGraduated };
}

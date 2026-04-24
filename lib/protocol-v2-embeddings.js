/**
 * Protocol v2 — Voyage embeddings wrapper + pgvector dedup helper.
 *
 * Reuses the project's existing Voyage AI setup (VOYAGE_API_KEY, voyage-3
 * model, 1024 dims) via lib/embeddings.js. Kept as a thin dedicated module
 * so the protocol pipeline can evolve (thresholds, filters) without
 * touching RAG chunking concerns.
 *
 * Used by the learning-loop pipeline (Chunk 2 of protocole-vivant plan):
 *   signal → extractor → embed → findSimilarProposition → merge or insert.
 */
import { embed, isEmbeddingAvailable } from "./embeddings.js";
import { log } from "./log.js";

export const EMBEDDING_DIM = 1024;

// Threshold source: docs/superpowers/specs/2026-04-24-protocole-vivant-design.md §3
// "embedding similarity >= 0.85 → MERGE count++".
export const SEMANTIC_DEDUP_THRESHOLD = 0.85;

/**
 * Embed a single short text (proposition proposed_text, ~50-500 chars).
 * @param {string} text
 * @returns {Promise<number[]|null>} 1024-dim vector, or null if unavailable/error.
 */
export async function embedForProposition(text) {
  if (!text || !text.trim()) return null;

  try {
    const results = await embed([text]);
    if (!results || !results[0]) return null;
    if (results[0].length !== EMBEDDING_DIM) {
      log("protocol_v2_embed_bad_shape", { len: results[0].length });
      return null;
    }
    return results[0];
  } catch (err) {
    log("protocol_v2_embed_error", { message: err.message });
    return null;
  }
}

/**
 * Is the protocol v2 embedding pipeline available?
 * @returns {boolean}
 */
export function isProtocolEmbeddingAvailable() {
  return isEmbeddingAvailable();
}

/**
 * Find pending propositions semantically similar to a candidate embedding.
 * Calls Postgres RPC `match_propositions` (migration 045).
 *
 * @param {object} supabase - Supabase service-role client.
 * @param {object} args
 * @param {string} args.documentId - protocol_document.id scope.
 * @param {number[]} args.embedding - 1024-dim query vector.
 * @param {string} [args.targetKind] - optional filter on proposition.target_kind.
 * @param {number} [args.threshold=SEMANTIC_DEDUP_THRESHOLD]
 * @param {number} [args.limit=5]
 * @returns {Promise<Array<{id: string, similarity: number, proposed_text: string, intent: string, target_kind: string, target_section_id: string|null, count: number}>>}
 */
export async function findSimilarProposition(supabase, args) {
  const {
    documentId,
    embedding,
    targetKind = null,
    threshold = SEMANTIC_DEDUP_THRESHOLD,
    limit = 5,
  } = args ?? {};

  if (!documentId || !Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) {
    return [];
  }

  const { data, error } = await supabase.rpc("match_propositions", {
    match_document_id: documentId,
    match_target_kind: targetKind,
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: limit,
  });

  if (error) {
    log("protocol_v2_match_error", { message: error.message });
    return [];
  }

  return data ?? [];
}

/**
 * Protocol v2 — OpenAI text-embedding-3-small wrapper + pgvector dedup helper.
 *
 * Used by the learning-loop pipeline (Chunk 2 of protocole-vivant plan) :
 *   signal → extractor → embed → findSimilarProposition → merge or insert.
 *
 * Kept separate from lib/embeddings.js (Voyage, 1024 dims, RAG chunks) —
 * proposition.embedding column is vector(1536) fixed by schema.
 */
import { log } from "./log.js";

const OPENAI_URL = "https://api.openai.com/v1/embeddings";
const MODEL = "text-embedding-3-small";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export const EMBEDDING_DIM = 1536;

// Threshold source: docs/superpowers/specs/2026-04-24-protocole-vivant-design.md §3
// "embedding similarity >= 0.85 → MERGE count++".
export const SEMANTIC_DEDUP_THRESHOLD = 0.85;

/**
 * Embed a single short text (proposition proposed_text, ~50-500 chars).
 * @param {string} text
 * @returns {Promise<number[]|null>} 1536-dim vector, or null if unavailable/timeout.
 */
export async function embedForProposition(text) {
  if (!OPENAI_API_KEY || !text || !text.trim()) return null;

  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ model: MODEL, input: text }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * Math.pow(2, attempt);
        log("protocol_v2_embed_retry", { attempt: attempt + 1, wait_ms: waitMs });
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (!res.ok) {
        log("protocol_v2_embed_failed", { status: res.status });
        return null;
      }
      const data = await res.json();
      const vec = data?.data?.[0]?.embedding;
      if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
        log("protocol_v2_embed_bad_shape", { len: vec?.length });
        return null;
      }
      return vec;
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === "AbortError") {
        log("protocol_v2_embed_timeout", { text_length: text.length, attempt });
        return null;
      }
      if (attempt >= MAX_RETRIES) {
        log("protocol_v2_embed_error", { message: err.message });
        return null;
      }
    }
  }

  return null;
}

/**
 * Is the protocol v2 embedding pipeline available?
 * @returns {boolean}
 */
export function isProtocolEmbeddingAvailable() {
  return !!OPENAI_API_KEY;
}

/**
 * Find pending propositions semantically similar to a candidate embedding.
 * Calls Postgres RPC `match_propositions` (migration 044).
 *
 * @param {object} supabase - Supabase service-role client.
 * @param {object} args
 * @param {string} args.documentId - protocol_document.id scope.
 * @param {number[]} args.embedding - 1536-dim query vector.
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

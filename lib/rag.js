/**
 * RAG retrieval — semantic search via pgvector.
 */

import { embedQuery } from "./embeddings.js";

/**
 * Retrieve semantically relevant chunks for a query.
 * @param {object} supabase - Supabase client
 * @param {string} personaId
 * @param {string} query - User message or recent context
 * @param {number} topK - Max chunks to retrieve
 * @returns {Promise<Array<{content: string, score: number}>>}
 */
export async function retrieveChunks(supabase, personaId, query, topK = 5) {
  const embedding = await embedQuery(query);
  if (!embedding) return [];

  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: embedding,
    match_persona_id: personaId,
    match_threshold: 0.5,
    match_count: topK,
  });

  if (error) {
    console.log(JSON.stringify({ event: "rag_error", error: error.message }));
    return [];
  }

  return (data || []).map((row) => ({
    content: row.content,
    score: row.similarity,
    source_path: row.source_path || null,
  }));
}

/**
 * Format retrieved chunks for system prompt injection.
 * Only includes chunks above the relevance threshold.
 * @param {Array<{content: string, score: number}>} chunks
 * @param {number} threshold - Minimum similarity score
 * @returns {string} Formatted context or empty string
 */
export function buildRagContext(chunks, threshold = 0.75) {
  const relevant = chunks.filter((c) => c.score >= threshold);
  if (relevant.length === 0) return "";

  const formatted = relevant.map((c) => c.content).join("\n\n---\n\n");
  return formatted;
}

/**
 * Voyage AI embeddings client.
 * Returns null gracefully if VOYAGE_API_KEY is not set.
 */
import { log } from "./log.js";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3";
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;

/**
 * Embed multiple texts (for documents/knowledge files).
 * @param {string[]} texts
 * @returns {Promise<number[][]|null>}
 */
export async function embed(texts) {
  if (!VOYAGE_API_KEY || !texts.length) return null;

  // Retry on 429 (rate limit) with backoff. Batches uploaded back-to-back
  // (e.g. 5 files uploaded in sequence) trigger Voyage rate limits; without
  // retry the tail of the batch silently loses its chunks.
  // Bumped from 3 to 5 retries (1s,2s,4s,8s,16s ≈ 31s total) after observing
  // 429s on a single PDF upload that stranded a doc with 0 RAG chunks.
  const MAX_RETRIES = 5;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await fetch(VOYAGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${VOYAGE_API_KEY}`,
        },
        body: JSON.stringify({ model: MODEL, input: texts, input_type: "document" }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * Math.pow(2, attempt); // 1s,2s,4s,8s,16s
        log("voyage_embed_retry", { attempt: attempt + 1, wait_ms: waitMs, count: texts.length });
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      if (!res.ok) throw new Error(`Voyage embed failed: ${res.status}`);
      const data = await res.json();
      return data.data.map((d) => d.embedding);
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === "AbortError") {
        log("voyage_embed_timeout", { count: texts.length, attempt });
        return null;
      }
      if (attempt >= MAX_RETRIES) throw err;
      // non-429 errors bubble immediately
      throw err;
    }
  }

  throw new Error("Voyage embed failed: rate-limited after retries");
}

/**
 * Embed a single query (for retrieval).
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
export async function embedQuery(text) {
  if (!VOYAGE_API_KEY || !text) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${VOYAGE_API_KEY}`,
      },
      body: JSON.stringify({ model: MODEL, input: [text], input_type: "query" }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Voyage query embed failed: ${res.status}`);
    const data = await res.json();
    return data.data[0].embedding;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      log("voyage_timeout", { text_length: text.length });
      return null;
    }
    throw err;
  }
}

/**
 * Check if embeddings are available.
 */
export function isEmbeddingAvailable() {
  return !!VOYAGE_API_KEY;
}

/**
 * Split text into chunks (paragraph-aware).
 * @param {string} text
 * @param {number} maxTokens - Approximate max tokens per chunk (default 500)
 * @returns {string[]}
 */
export function chunkText(text, maxTokens = 500) {
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim());
  const chunks = [];
  let current = "";

  for (const para of paragraphs) {
    const estimatedTokens = Math.ceil((current + "\n\n" + para).split(/\s+/).length * 0.75);
    if (estimatedTokens > maxTokens && current) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // If no paragraphs found, split by sentences
  if (chunks.length === 0 && text.trim()) {
    chunks.push(text.trim());
  }

  return chunks;
}

/**
 * Embed and store chunks in Supabase.
 * @param {object} supabase - Supabase client
 * @param {string[]} chunks - Text chunks
 * @param {string} personaId
 * @param {string} sourceType - e.g., "knowledge_file", "document"
 */
export async function embedAndStore(supabase, chunks, personaId, sourceType = "knowledge_file", sourcePath = null) {
  if (!chunks.length) return 0;

  const BATCH_SIZE = 8;
  let stored = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const embeddings = await embed(batch);
    if (!embeddings) throw new Error(`Embedding failed (likely timeout) for ${sourceType} batch ${i / BATCH_SIZE}`);

    const rows = batch.map((content, j) => ({
      persona_id: personaId,
      content,
      embedding: JSON.stringify(embeddings[j]),
      source_type: sourceType,
      source_path: sourcePath,
      metadata: { index: i + j },
    }));

    const { error } = await supabase.from("chunks").insert(rows);
    if (error) throw new Error(`Chunk insert failed: ${error.message}`);
    stored += batch.length;
  }

  return stored;
}

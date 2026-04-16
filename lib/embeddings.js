/**
 * Voyage AI embeddings client.
 * Returns null gracefully if VOYAGE_API_KEY is not set.
 */

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

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, input: texts, input_type: "document" }),
  });

  if (!res.ok) throw new Error(`Voyage embed failed: ${res.status}`);
  const data = await res.json();
  return data.data.map((d) => d.embedding);
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
      console.log(JSON.stringify({ event: "voyage_timeout", text_length: text.length }));
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

  const BATCH_SIZE = 32;
  let stored = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const embeddings = await embed(batch);
    if (!embeddings) return stored;

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

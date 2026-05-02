// Re-embed les knowledge_files Nicolas qui n'ont pas de chunks (séquelle Phase 0.1).
// Version 2 : batch de 1 + diag fine + sleep entre batches anti rate-limit.
//
// Usage : node scripts/reembed-nicolas-knowledge.js [--dry-run]

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chunkText } from "../lib/embeddings.js";

dotenv.config({ path: "C:/Users/abrah/AhmetA/.env" });

const DRY_RUN = process.argv.includes("--dry-run");
const NICOLAS_SLUG = "nicolas-lavall-e";
const SLEEP_MS = 22_000;       // Voyage free tier: 3 RPM = 1 req/20s, 22s pour marge
const TIMEOUT_MS = 60_000;     // up de 30s à 60s
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function embedOne(text) {
  const t0 = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
      body: JSON.stringify({ model: "voyage-3", input: [text], input_type: "document" }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return { embedding: data.data[0].embedding, elapsed: Date.now() - t0, tokens: data.usage?.total_tokens };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      throw new Error(`timeout after ${Date.now() - t0}ms (limit ${TIMEOUT_MS}ms)`);
    }
    throw err;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { data: nicolas } = await sb.from("personas").select("id, intelligence_source_id").eq("slug", NICOLAS_SLUG).single();
const intellId = nicolas.intelligence_source_id || nicolas.id;
console.log(`Nicolas intellId: ${intellId}\n`);

const { data: kfs } = await sb.from("knowledge_files")
  .select("id, path, content, document_type")
  .eq("persona_id", intellId)
  .order("created_at", { ascending: false })
  .limit(20);

let totalEmbedded = 0;
let totalFailed = 0;

for (const kf of kfs) {
  const { count: chunkCount } = await sb.from("chunks")
    .select("*", { count: "exact", head: true })
    .eq("persona_id", intellId)
    .eq("source_path", kf.path);

  if (chunkCount > 0) {
    console.log(`✓ ${kf.path}  chunks=${chunkCount}  (skipping)`);
    continue;
  }

  const chunks = chunkText(kf.content);
  console.log(`📄 ${kf.path}`);
  console.log(`   ${kf.content.length} chars → ${chunks.length} chunks`);

  if (DRY_RUN) {
    console.log(`   (dry-run) would embed ${chunks.length} chunks`);
    continue;
  }

  const rows = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const { embedding, elapsed, tokens } = await embedOne(chunk);
      rows.push({
        persona_id: intellId,
        content: chunk,
        embedding: JSON.stringify(embedding),
        source_type: "knowledge_file",
        source_path: kf.path,
        metadata: { index: i },
      });
      console.log(`   ✓ chunk ${i + 1}/${chunks.length}  ${chunk.length}c  ${tokens}t  ${elapsed}ms`);
      totalEmbedded++;
    } catch (err) {
      console.error(`   ✗ chunk ${i + 1}/${chunks.length}: ${err.message}`);
      totalFailed++;
    }
    if (i < chunks.length - 1) await sleep(SLEEP_MS);
  }

  if (rows.length > 0) {
    const { error: insErr } = await sb.from("chunks").insert(rows);
    if (insErr) console.error(`   ✗ chunks INSERT: ${insErr.message}`);
    else console.log(`   ✓ inserted ${rows.length} chunks rows`);
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`embedded ok : ${totalEmbedded}`);
console.log(`failed      : ${totalFailed}`);

const { count: totalNicolasChunks } = await sb.from("chunks")
  .select("*", { count: "exact", head: true })
  .eq("persona_id", intellId);
console.log(`Total Nicolas chunks now: ${totalNicolasChunks}`);

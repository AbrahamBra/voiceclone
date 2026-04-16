#!/usr/bin/env node
/**
 * Index knowledge files as RAG chunks for personas missing embeddings.
 * Reuses chunkText() and embedAndStore() from lib/embeddings.js.
 *
 * Usage: node scripts/sync-knowledge-embeddings.js [--persona thomas]
 */

// Load env BEFORE importing embeddings (which captures VOYAGE_API_KEY at module level)
import { config } from "dotenv";
config({ path: ".env.local" });
config();

const { chunkText, embedAndStore, isEmbeddingAvailable } = await import("../lib/embeddings.js");
const { createClient } = await import("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PERSONA_FILTER = process.argv.includes("--persona")
  ? process.argv[process.argv.indexOf("--persona") + 1]
  : null;

async function main() {
  if (!isEmbeddingAvailable()) {
    console.error("VOYAGE_API_KEY not set — cannot embed");
    process.exit(1);
  }

  console.log("📦 Sync Knowledge Embeddings");

  // Get personas
  let query = supabase.from("personas").select("id, name, slug");
  if (PERSONA_FILTER) query = query.eq("slug", PERSONA_FILTER);
  const { data: personas } = await query;

  if (!personas?.length) {
    console.log("No personas found");
    return;
  }

  for (const persona of personas) {
    console.log(`\n═══ ${persona.name} (${persona.slug}) ═══`);

    // Load knowledge files
    const { data: files } = await supabase
      .from("knowledge_files")
      .select("path, content")
      .eq("persona_id", persona.id);

    if (!files?.length) {
      console.log("  No knowledge files, skipping");
      continue;
    }

    // Check which files are already indexed
    const { data: existingChunks } = await supabase
      .from("chunks")
      .select("source_path")
      .eq("persona_id", persona.id)
      .not("source_path", "is", null);

    const indexedPaths = new Set((existingChunks || []).map(c => c.source_path));

    let totalChunks = 0;
    for (const file of files) {
      if (indexedPaths.has(file.path)) {
        console.log(`  ✓ ${file.path} — already indexed, skipping`);
        continue;
      }
      if (!file.content || file.content.trim().length < 20) {
        console.log(`  ⚠ ${file.path} — too short, skipping`);
        continue;
      }

      const chunks = chunkText(file.content);
      console.log(`  → ${file.path} — ${chunks.length} chunks`);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const stored = await embedAndStore(supabase, chunks, persona.id, "knowledge_file", file.path);
          totalChunks += stored;
          break;
        } catch (err) {
          if (err.message.includes("429") && attempt < 2) {
            const wait = 30 * (attempt + 1);
            console.log(`  ⏳ Rate limited, waiting ${wait}s (attempt ${attempt + 1}/3)...`);
            await new Promise(r => setTimeout(r, wait * 1000));
          } else {
            throw err;
          }
        }
      }
      // Small delay between files to avoid rate limits
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`  📊 ${totalChunks} new chunks indexed`);
  }

  console.log("\n✅ Done!");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });

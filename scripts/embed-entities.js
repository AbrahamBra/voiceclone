#!/usr/bin/env node
/**
 * Backfill embeddings on existing knowledge_entities.
 * Embeds "name: description" for each entity missing an embedding.
 *
 * Usage: node scripts/embed-entities.js [--persona thomas]
 */

// Load env BEFORE importing embeddings (captures VOYAGE_API_KEY at module level)
import { config } from "dotenv";
config({ path: ".env.local" });
config();

const { embed, isEmbeddingAvailable } = await import("../lib/embeddings.js");
const { createClient } = await import("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PERSONA_FILTER = process.argv.includes("--persona")
  ? process.argv[process.argv.indexOf("--persona") + 1]
  : null;

const BATCH_SIZE = 32;

async function main() {
  if (!isEmbeddingAvailable()) {
    console.error("VOYAGE_API_KEY not set — cannot embed");
    process.exit(1);
  }

  console.log("🧠 Embed Entities Backfill");

  let query = supabase
    .from("knowledge_entities")
    .select("id, name, description, persona_id")
    .is("embedding", null);

  if (PERSONA_FILTER) {
    const { data: p } = await supabase.from("personas").select("id").eq("slug", PERSONA_FILTER).single();
    if (!p) { console.error(`Persona "${PERSONA_FILTER}" not found`); process.exit(1); }
    query = query.eq("persona_id", p.id);
  }

  const { data: entities } = await query;
  if (!entities?.length) {
    console.log("No entities need embedding");
    return;
  }

  console.log(`Found ${entities.length} entities without embeddings`);

  for (let i = 0; i < entities.length; i += BATCH_SIZE) {
    const batch = entities.slice(i, i + BATCH_SIZE);
    const texts = batch.map(e => `${e.name}: ${e.description || e.name}`);

    console.log(`  Embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(entities.length / BATCH_SIZE)}...`);

    let embeddings;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        embeddings = await embed(texts);
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

    if (!embeddings) {
      console.error("  ✗ Embedding failed, stopping");
      break;
    }

    for (let j = 0; j < batch.length; j++) {
      const { error } = await supabase
        .from("knowledge_entities")
        .update({ embedding: JSON.stringify(embeddings[j]) })
        .eq("id", batch[j].id);
      if (error) console.error(`  ✗ Failed to update ${batch[j].name}: ${error.message}`);
    }
    console.log(`  ✓ ${batch.length} entities embedded`);

    // Small delay between batches to avoid rate limits
    if (i + BATCH_SIZE < entities.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log("\n✅ Done!");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });

# Intelligence Boost Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the entity graph actually useful at runtime by indexing knowledge as RAG chunks, switching to semantic entity matching, and auto-extracting entities on knowledge upload.

**Architecture:** Three additive changes layered in order: (1) migration adds embedding column + RPC, (2) scripts index existing data, (3) runtime code uses semantic matching instead of exact text matching. All changes fall back to existing behavior if Voyage AI is unavailable.

**Tech Stack:** Supabase pgvector, Voyage AI (voyage-3), Claude Haiku for extraction

**Spec:** `docs/superpowers/specs/2026-04-16-intelligence-boost-design.md`

---

## Chunk 1: Migration + RAG Indexing Script

### Task 1: Supabase Migration — Entity Embeddings

**Files:**
- Create: `supabase/011_entity_embeddings.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Migration: Add embedding column to knowledge_entities for semantic matching
-- Replicates the pattern from 003_chunks_rag.sql (hnsw + match function)

ALTER TABLE knowledge_entities
  ADD COLUMN IF NOT EXISTS embedding vector(1024);

CREATE INDEX IF NOT EXISTS idx_entities_embedding
  ON knowledge_entities
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Semantic match function for entities (mirrors match_chunks pattern)
CREATE OR REPLACE FUNCTION match_entities(
  query_embedding vector(1024),
  match_persona_id uuid,
  match_threshold float DEFAULT 0.4,
  match_count int DEFAULT 8
)
RETURNS TABLE (id uuid, name text, type text, description text, confidence numeric, similarity float)
LANGUAGE SQL STABLE
AS $$
  SELECT
    e.id,
    e.name,
    e.type,
    e.description,
    e.confidence,
    1 - (e.embedding <=> query_embedding) as similarity
  FROM knowledge_entities e
  WHERE e.persona_id = match_persona_id
    AND e.confidence >= 0.6
    AND e.embedding IS NOT NULL
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;
```

- [ ] **Step 2: Run migration on Supabase**

Run in Supabase SQL Editor or via CLI:
```bash
# If using Supabase CLI:
supabase db push
# Otherwise: paste SQL into Supabase Dashboard > SQL Editor > Run
```

Expected: Migration succeeds, `knowledge_entities` now has `embedding` column, `match_entities` function exists.

- [ ] **Step 3: Commit**

```bash
git add supabase/011_entity_embeddings.sql
git commit -m "feat: add entity embedding column + match_entities RPC"
```

---

### Task 2: Script — Sync Knowledge Embeddings

**Files:**
- Create: `scripts/sync-knowledge-embeddings.js`

- [ ] **Step 1: Write the sync script**

```js
#!/usr/bin/env node
/**
 * Index knowledge files as RAG chunks for personas missing embeddings.
 * Reuses chunkText() and embedAndStore() from lib/embeddings.js.
 *
 * Usage: node scripts/sync-knowledge-embeddings.js [--persona thomas]
 */
import { config } from "dotenv";
config();
import { createClient } from "@supabase/supabase-js";
import { chunkText, embedAndStore, isEmbeddingAvailable } from "../lib/embeddings.js";

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
      const stored = await embedAndStore(supabase, chunks, persona.id, "knowledge_file", file.path);
      totalChunks += stored;
    }

    console.log(`  📊 ${totalChunks} new chunks indexed`);
  }

  console.log("\n✅ Done!");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
```

- [ ] **Step 2: Test the script in dry mode (verify it reads data correctly)**

```bash
node scripts/sync-knowledge-embeddings.js --persona thomas
```

Expected: Script runs, shows knowledge files found, chunks them, embeds and stores. Output shows `N new chunks indexed` for Thomas.

- [ ] **Step 3: Run for all personas**

```bash
node scripts/sync-knowledge-embeddings.js
```

Expected: All personas get their knowledge files indexed. Already-indexed files (Thierry's) are skipped.

- [ ] **Step 4: Verify in DB**

```bash
node --input-type=module -e "
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await sb.from('chunks').select('persona_id, source_path').not('source_path','is',null);
const grouped = {};
for (const c of data || []) {
  grouped[c.persona_id] = (grouped[c.persona_id] || 0) + 1;
}
console.log(grouped);
"
```

Expected: Thomas now has chunks > 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-knowledge-embeddings.js
git commit -m "feat: add sync-knowledge-embeddings script for RAG indexing"
```

---

## Chunk 2: Semantic Entity Matching

### Task 3: Script — Backfill Entity Embeddings

**Files:**
- Create: `scripts/embed-entities.js`

- [ ] **Step 1: Write the backfill script**

```js
#!/usr/bin/env node
/**
 * Backfill embeddings on existing knowledge_entities.
 * Embeds "name: description" for each entity missing an embedding.
 *
 * Usage: node scripts/embed-entities.js [--persona thomas]
 */
import { config } from "dotenv";
config();
import { createClient } from "@supabase/supabase-js";
import { embed, isEmbeddingAvailable } from "../lib/embeddings.js";

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
    const embeddings = await embed(texts);
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
  }

  console.log("\n✅ Done!");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
```

- [ ] **Step 2: Run backfill for all personas**

```bash
node scripts/embed-entities.js
```

Expected: All 83 Thomas + 157 Thierry entities get embeddings. Output shows batch progress.

- [ ] **Step 3: Verify in DB**

```bash
node --input-type=module -e "
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { count: total } = await sb.from('knowledge_entities').select('id', { count: 'exact' });
const { count: withEmb } = await sb.from('knowledge_entities').select('id', { count: 'exact' }).not('embedding', 'is', null);
console.log('Total:', total, 'With embedding:', withEmb);
"
```

Expected: `With embedding` equals `Total` (all entities now have embeddings).

- [ ] **Step 4: Commit**

```bash
git add scripts/embed-entities.js
git commit -m "feat: add embed-entities backfill script"
```

---

### Task 4: Semantic Matching in findRelevantEntities

**Files:**
- Modify: `lib/knowledge-db.js` — `findRelevantEntities()` (lines 142-211)

- [ ] **Step 1: Write the test**

Create `test/entity-matching.test.js`:

```js
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

/**
 * Unit test for the semantic matching fallback logic.
 * We test the fallback path (text matching) since semantic matching
 * requires a live Voyage API + Supabase RPC.
 * The semantic path is verified by the backfill + manual testing.
 */
describe("findRelevantEntities fallback", () => {
  it("returns empty when no entities exist", async () => {
    // This tests the early return at line 144
    const { findRelevantEntities } = await import("../lib/knowledge-db.js");
    // With a non-existent persona, loadPersonaData returns null
    const result = await findRelevantEntities("00000000-0000-0000-0000-000000000000", [
      { role: "user", content: "test message" },
    ]);
    assert.deepStrictEqual(result, { entities: [], relations: [], boostTerms: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it passes (baseline)**

```bash
node --test test/entity-matching.test.js
```

Expected: PASS — the empty-persona path works.

- [ ] **Step 3: Modify `findRelevantEntities` for semantic matching**

In `lib/knowledge-db.js`, replace the matching logic inside `findRelevantEntities`. The function signature and return shape stay identical. Changes:

1. Import `embedQuery` at the top of the file
2. Replace the text-includes matching block (lines 153-163) with an `embedQuery` + `supabase.rpc("match_entities")` call
3. Fall back to text matching if `embedQuery` returns null

```js
// Add to imports at top of file:
import { embedQuery } from "./embeddings.js";
```

Replace the body of `findRelevantEntities` from line 146 (`const text = ...`) through line 167 (`const directIds = ...`) with:

```js
  const text = normalize(messages.slice(-6).map((m) => m.content).join(" "));
  const now = Date.now();

  // 1. Filter by confidence threshold
  const eligible = data.entities.filter(e => (e.confidence || 1.0) >= 0.6);

  // 2. Try semantic matching first, fall back to text matching
  let directMatches = [];

  const queryText = messages.slice(-3).map(m => m.content).join(" ").slice(0, 1000);
  const queryEmbedding = await embedQuery(queryText);

  if (queryEmbedding) {
    // Semantic match via pgvector
    try {
      const { data: matched } = await supabase.rpc("match_entities", {
        query_embedding: queryEmbedding,
        match_persona_id: personaId,
        match_threshold: 0.4,
        match_count: 8,
      });

      if (matched?.length > 0) {
        // Enrich RPC results with cached entity data (for graph walking)
        const cachedMap = {};
        for (const e of eligible) cachedMap[e.id] = e;

        for (const m of matched) {
          const cached = cachedMap[m.id];
          if (cached) {
            const lastMatched = cached.last_matched_at ? new Date(cached.last_matched_at).getTime() : now;
            const daysSince = (now - lastMatched) / (1000 * 60 * 60 * 24);
            const recencyFactor = Math.max(0.1, 1.0 - (daysSince / 90));
            directMatches.push({
              ...cached,
              score: m.similarity * (m.confidence || 1.0) * recencyFactor,
            });
          }
        }
      }
    } catch (err) {
      console.log(JSON.stringify({ event: "entity_semantic_match_error", error: err.message }));
    }
  }

  // Fallback: text matching (original logic)
  if (directMatches.length === 0) {
    for (const entity of eligible) {
      if (text.includes(normalize(entity.name))) {
        const lastMatched = entity.last_matched_at ? new Date(entity.last_matched_at).getTime() : now;
        const daysSince = (now - lastMatched) / (1000 * 60 * 60 * 24);
        const recencyFactor = Math.max(0.1, 1.0 - (daysSince / 90));
        directMatches.push({ ...entity, score: (entity.confidence || 1.0) * recencyFactor });
      }
    }
  }

  // 3. Sort by score DESC, take top 8
  directMatches.sort((a, b) => b.score - a.score);
  const topDirect = directMatches.slice(0, 8);
  const directIds = new Set(topDirect.map(e => e.id));
```

Everything after `directIds` (graph walk, relations, last_matched_at update, return) stays **unchanged**.

- [ ] **Step 4: Run existing tests to verify no regression**

```bash
node --test test/prompt.test.js
node --test test/entity-matching.test.js
```

Expected: All tests PASS.

- [ ] **Step 5: Manual integration test**

```bash
node --input-type=module -e "
import { config } from 'dotenv';
config();
import { findRelevantEntities } from './lib/knowledge-db.js';

const thomas = 'dd26c9a6-0f0a-4d01-9ae0-d942f71f81cb';
const result = await findRelevantEntities(thomas, [
  { role: 'user', content: 'Comment tu fais pour avoir des rendez-vous qualifiés sur LinkedIn ?' },
]);
console.log('Direct:', result.directCount, 'Graph:', result.graphCount);
console.log('Entities:', result.entities.map(e => e.name));
console.log('BoostTerms:', result.boostTerms);
"
```

Expected: Multiple entities matched (should see concepts like "Rendez-vous qualifiés", "GTM LinkedIn", etc.) instead of 0-1 with the old exact matching.

- [ ] **Step 6: Commit**

```bash
git add lib/knowledge-db.js test/entity-matching.test.js
git commit -m "feat: semantic entity matching via pgvector with text fallback"
```

---

## Chunk 3: Auto-Extraction on Knowledge Upload

### Task 5: Add `extractEntitiesFromContent` to graph-extraction.js

**Files:**
- Modify: `lib/graph-extraction.js`

- [ ] **Step 1: Add the content-focused extraction prompt and function**

Add at the end of `lib/graph-extraction.js` (after the existing `extractGraphKnowledge` function):

```js
/**
 * Content-focused extraction prompt (from bootstrap-graph.js).
 * Different from GRAPH_EXTRACTION_PROMPT which is correction-focused.
 */
const CONTENT_EXTRACTION_PROMPT = `Tu es un expert en extraction de connaissances pour un clone de voix IA.
Analyse ce contenu et extrais TOUTES les entites et relations utiles pour construire un graphe de connaissances.

Types d'entites : concept, framework, person, company, metric, belief, tool, style_rule
Types de relations : equals, includes, contradicts, causes, uses, prerequisite, enforces

Pour les regles de voix, extrais chaque regle comme style_rule.
Pour les fichiers knowledge, extrais :
- Concepts metier, frameworks, methodologies
- Personnes, entreprises, outils mentionnes
- Metriques et chiffres cles
- Croyances et convictions

Reponds en JSON :
{
  "entities": [{ "name": "...", "type": "...", "description": "..." }],
  "relations": [{ "from": "...", "to": "...", "type": "...", "description": "..." }]
}`;

/**
 * Extract entities/relations from knowledge content (not corrections).
 * Used when knowledge files are uploaded via /api/clone.
 * Best-effort: failures are logged but don't block the caller.
 *
 * @param {string} personaId
 * @param {string} content - Knowledge file content
 * @param {string} sourcePath - e.g. "topics/style-posts-linkedin.md"
 * @param {object} client - Auth client (for API key resolution)
 * @returns {Promise<{entityCount: number}>}
 */
export async function extractEntitiesFromContent(personaId, content, sourcePath, client) {
  const EMPTY = { entityCount: 0 };
  if (!content || content.trim().length < 30) return EMPTY;

  try {
    const apiKey = getApiKey(client);
    const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

    const result = await Promise.race([
      anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: CONTENT_EXTRACTION_PROMPT,
        messages: [{
          role: "user",
          content: `Source : ${sourcePath}\n\nContenu :\n${content.slice(0, 4000)}`,
        }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
    ]);

    const raw = result.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return EMPTY;

    let data;
    try { data = JSON.parse(jsonMatch[0]); } catch { return EMPTY; }
    if (!data.entities?.length) return EMPTY;

    // Upsert entities
    const entityRows = data.entities.map(e => ({
      persona_id: personaId,
      name: e.name,
      type: VALID_ENTITY_TYPES.has(e.type) ? e.type : "concept",
      description: e.description || "",
      confidence: 0.8,
    }));

    const { data: inserted } = await supabase
      .from("knowledge_entities")
      .upsert(entityRows, { onConflict: "persona_id,name" })
      .select("id, name");

    const entityCount = inserted?.length || 0;

    // Insert relations
    if (inserted?.length > 0 && data.relations?.length > 0) {
      const { data: allEntities } = await supabase
        .from("knowledge_entities").select("id, name").eq("persona_id", personaId);
      const entityMap = {};
      for (const e of (allEntities || [])) entityMap[e.name] = e.id;

      const relationRows = data.relations
        .filter(r => entityMap[r.from] && entityMap[r.to])
        .map(r => ({
          persona_id: personaId,
          from_entity_id: entityMap[r.from],
          to_entity_id: entityMap[r.to],
          relation_type: VALID_RELATION_TYPES.has(r.type) ? r.type : "uses",
          description: r.description || "",
          confidence: 0.8,
        }));
      if (relationRows.length > 0) {
        await supabase.from("knowledge_relations").insert(relationRows);
      }
    }

    // Best-effort: embed new entities (non-blocking)
    if (inserted?.length > 0) {
      try {
        const { embed: embedBatch } = await import("./embeddings.js");
        const texts = inserted.map(e => {
          const full = entityRows.find(r => r.name === e.name);
          return `${e.name}: ${full?.description || e.name}`;
        });
        const embeddings = await embedBatch(texts);
        if (embeddings) {
          for (let j = 0; j < inserted.length; j++) {
            await supabase.from("knowledge_entities")
              .update({ embedding: JSON.stringify(embeddings[j]) })
              .eq("id", inserted[j].id);
          }
        }
      } catch (embErr) {
        console.log(JSON.stringify({ event: "entity_embed_error", persona: personaId, error: embErr.message }));
      }
    }

    console.log(JSON.stringify({
      event: "content_entities_extracted",
      persona: personaId,
      source: sourcePath,
      entities: entityCount,
    }));

    return { entityCount };
  } catch (e) {
    console.log(JSON.stringify({
      event: "content_extraction_error",
      persona: personaId,
      source: sourcePath,
      error: e.message,
    }));
    return EMPTY;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/graph-extraction.js
git commit -m "feat: add extractEntitiesFromContent for knowledge upload"
```

---

### Task 6: Graft Auto-Extraction into clone.js

**Files:**
- Modify: `api/clone.js`

- [ ] **Step 1: Add import**

At top of `api/clone.js`, add:

```js
import { extractEntitiesFromContent } from "../lib/graph-extraction.js";
```

- [ ] **Step 2: Add auto-extraction after knowledge file inserts**

In `api/clone.js`, after the existing embedding block (lines 350-369, the `if (isEmbeddingAvailable())` block), add entity extraction for each knowledge file. Insert this block right after the embedding try/catch and before `res.json(...)` (line 372):

```js
    // Auto-extract entities from knowledge files (best-effort, non-blocking timeout)
    try {
      const extractionPromises = [];
      if (styleBody) {
        extractionPromises.push(
          extractEntitiesFromContent(persona.id, styleBody, "topics/style-posts-linkedin.md", client)
        );
      }
      if (dmResult) {
        const dmBody = dmResult.content[0].text.trim().replace(/^---\n[\s\S]*?\n---\n?/, "");
        extractionPromises.push(
          extractEntitiesFromContent(persona.id, dmBody, "topics/style-conversations.md", client)
        );
      }
      if (documents && documents.length > 50) {
        extractionPromises.push(
          extractEntitiesFromContent(persona.id, documents, "documents/client-docs.md", client)
        );
      }
      if (extractionPromises.length > 0) {
        await Promise.race([
          Promise.all(extractionPromises),
          new Promise((_, reject) => setTimeout(() => reject(new Error("extraction_timeout")), 25000)),
        ]);
      }
    } catch (e) {
      console.log(JSON.stringify({ event: "auto_extraction_error", persona: persona.id, error: e.message }));
    }
```

- [ ] **Step 3: Run existing tests**

```bash
node --test test/prompt.test.js
```

Expected: PASS — no regression.

- [ ] **Step 4: Commit**

```bash
git add api/clone.js
git commit -m "feat: auto-extract entities on knowledge upload in clone API"
```

---

### Task 7: Also embed entities in existing extractGraphKnowledge

**Files:**
- Modify: `lib/graph-extraction.js` — `extractGraphKnowledge()` function

- [ ] **Step 1: Add entity embedding after upsert in extractGraphKnowledge**

In `extractGraphKnowledge`, after the entity upsert block (around line 102, after `entityCount = inserted?.length || 0;`), add embedding for newly inserted entities:

```js
      // Embed new entities for semantic matching
      if (inserted?.length > 0) {
        try {
          const { embed: embedBatch } = await import("./embeddings.js");
          const texts = inserted.map(e => {
            const full = entityRows.find(r => r.name === e.name);
            return `${e.name}: ${full?.description || e.name}`;
          });
          const embeddings = await embedBatch(texts);
          if (embeddings) {
            for (let j = 0; j < inserted.length; j++) {
              await supabase.from("knowledge_entities")
                .update({ embedding: JSON.stringify(embeddings[j]) })
                .eq("id", inserted[j].id);
            }
          }
        } catch (embErr) {
          // Best-effort: backfill script can pick up missed ones
          console.log(JSON.stringify({ event: "entity_embed_inline_error", error: embErr.message }));
        }
      }
```

- [ ] **Step 2: Run tests**

```bash
node --test
```

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/graph-extraction.js
git commit -m "feat: embed entities inline during feedback extraction"
```

---

### Task 8: Final Backfill — Run All Scripts

- [ ] **Step 1: Run sync-knowledge-embeddings for all personas**

```bash
node scripts/sync-knowledge-embeddings.js
```

Expected: All personas get knowledge files indexed as RAG chunks.

- [ ] **Step 2: Run embed-entities for all personas**

```bash
node scripts/embed-entities.js
```

Expected: All entities get embeddings.

- [ ] **Step 3: Verify final state**

```bash
node --input-type=module -e "
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

for (const slug of ['thomas', 'thierry', 'paolo', 'victor']) {
  const { data: p } = await sb.from('personas').select('id, name').eq('slug', slug).single();
  if (!p) continue;
  const { count: ent } = await sb.from('knowledge_entities').select('id', { count: 'exact' }).eq('persona_id', p.id).not('embedding', 'is', null);
  const { count: entTotal } = await sb.from('knowledge_entities').select('id', { count: 'exact' }).eq('persona_id', p.id);
  const { count: chunks } = await sb.from('chunks').select('id', { count: 'exact' }).eq('persona_id', p.id);
  console.log(p.name + ': entities=' + entTotal + ' (embedded=' + ent + '), chunks=' + chunks);
}
"
```

Expected: All personas have entities with embeddings AND RAG chunks > 0.

- [ ] **Step 4: Integration test — semantic matching in action**

```bash
node --input-type=module -e "
import { config } from 'dotenv';
config();
import { findRelevantEntities } from './lib/knowledge-db.js';

const thomas = 'dd26c9a6-0f0a-4d01-9ae0-d942f71f81cb';

// Test with a message that mentions concepts indirectly
const result = await findRelevantEntities(thomas, [
  { role: 'user', content: 'Comment générer des leads qualifiés avec du contenu sur les réseaux sociaux ?' },
]);
console.log('Matched:', result.directCount, 'entities +', result.graphCount, 'via graph');
for (const e of result.entities.slice(0, 5)) {
  console.log('  -', e.name, '(score=' + (e.score?.toFixed(2) || '?') + ')');
}
"
```

Expected: Multiple entities matched semantically (even though the message doesn't contain exact entity names like "GTM LinkedIn" or "Social funnel").

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: intelligence boost — RAG indexing + semantic entities + auto-extraction"
```

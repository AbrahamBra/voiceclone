# Intelligence Boost — RAG + Semantic Entity Matching + Auto-Extraction

**Date:** 2026-04-16
**Status:** Approved

## Problem

Thomas has 83 entities and 7 knowledge files but:
- **0 RAG chunks** (no embeddings indexed) — semantic retrieval can't work
- **1/83 entities ever matched** at runtime — exact text matching is useless
- Entities only emerge from user feedback, not from knowledge content

Thierry has 157 entities and 10 RAG chunks, which makes his intelligence feel more relevant. But even Thierry only matched 2/157 entities — the matching problem is systemic.

## Solution — 3 Axes

### Axe 1: Index Knowledge Files as RAG Chunks

Thomas has 7 knowledge files in DB but 0 embeddings. Fix: index them.

**New script:** `scripts/sync-knowledge-embeddings.js`
- Reads `knowledge_files` from DB for a persona
- Chunks content via `chunkText()` from `lib/embeddings.js`
- Embeds via Voyage AI and stores in `chunks` table via `embedAndStore()`
- Skips files already indexed (checks `source_path` in chunks table)
- CLI: `node scripts/sync-knowledge-embeddings.js --persona thomas`

No new dependencies — assembles existing functions.

### Axe 2: Semantic Entity Matching via pgvector

Replace exact text matching with embedding-based cosine similarity.

**Current** (`knowledge-db.js:154`):
```js
text.includes(normalize(entity.name))  // 1/83 match rate
```

**New:**
1. Add `embedding vector(1024)` column to `knowledge_entities`
2. New Supabase RPC `match_entities(query_embedding, match_persona_id, match_threshold, match_count)`
3. At entity insertion: embed `"name: description"` via Voyage AI
4. At runtime: embed recent messages, call `match_entities`, take top 8
5. Fallback: if `embedQuery()` returns null (timeout/unavailable), fall back to current text matching
6. **Cache interaction:** semantic match replaces ONLY the text-includes step (lines 153-163). The cached `data.entities` is still needed for confidence filtering, and `data.relations` for the 1-hop graph walk. The RPC returns matched entity IDs, which are then looked up in the cache for scoring and graph walking.

**Migration:** `supabase/010_entity_embeddings.sql`
- ALTER TABLE add embedding column
- CREATE INDEX using hnsw (better than ivfflat for small datasets, no list tuning needed)
- CREATE FUNCTION match_entities

**Backfill script:** `scripts/embed-entities.js`
- Reads all entities without embeddings
- Embeds in batches of 32
- Updates rows with embeddings

### Axe 3: Auto-Extract Entities on Knowledge Upload

When knowledge content is added via `/api/clone`, automatically:
1. Chunk + embed content (Axe 1 logic)
2. Call Haiku to extract entities/relations (reuse bootstrap-graph.js prompt)
3. Upsert into `knowledge_entities` + `knowledge_relations`
4. Embed new entities (Axe 2 logic)

**New function:** `extractEntitiesFromContent(personaId, content, sourcePath, client)` in `lib/graph-extraction.js`
- Uses the content-focused `EXTRACTION_PROMPT` (from bootstrap-graph.js), NOT the correction-focused `GRAPH_EXTRACTION_PROMPT` already in the file — different prompts for different contexts
- Called from `api/clone.js` after knowledge file sync (covers all knowledge types including DM style files)
- Entity embedding during upload is best-effort/non-blocking (Promise.race with timeout), so a slow Voyage response doesn't block the clone creation response

**No new endpoint** — grafted onto existing upload flow.

## Files Changed

| File | Change |
|---|---|
| `supabase/010_entity_embeddings.sql` | New migration: embedding column + match_entities RPC |
| `lib/knowledge-db.js` | `findRelevantEntities()` → semantic match via pgvector |
| `lib/graph-extraction.js` | Embed entities on insertion + new `extractEntitiesFromContent()` |
| `scripts/sync-knowledge-embeddings.js` | New: index knowledge files as RAG chunks |
| `scripts/embed-entities.js` | New: backfill embeddings on existing entities |
| `api/clone.js` | Graft auto-extraction after knowledge upload |

## Non-Goals

- No changes to the feedback detection system (it works, just needs more data)
- No UI changes
- No new API endpoints
- No changes to the prompt building logic (it already handles entities well)

## Risks

- Voyage AI rate limits on backfill — mitigated by batching (32 at a time)
- pgvector index performance with small dataset — negligible, under 200 entities
- Haiku extraction quality — already proven in bootstrap-graph.js

## Execution Order

1. Migration (schema first)
2. Axe 1: sync-knowledge-embeddings script + run for thomas
3. Axe 2: entity embeddings + semantic matching + backfill
4. Axe 3: auto-extraction on upload
5. Run backfill scripts for all personas

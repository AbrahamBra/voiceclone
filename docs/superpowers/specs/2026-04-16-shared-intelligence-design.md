# Shared Intelligence Between Clones + Contributor Tracking

## Problem

Intelligence (corrections, knowledge graph, embeddings) is scoped per-persona. When two users share the same clone concept (e.g. "immostate"), their intelligence pools are isolated. We need a way for multiple clones to read/write to a single shared intelligence pool, and to see who contributes.

## Design

### 1. Schema: `intelligence_source_id`

Add one column to `personas`:

```sql
ALTER TABLE personas
  ADD COLUMN intelligence_source_id uuid REFERENCES personas(id);
```

**Convention:** `intelligence_source_id` is `NULL` by default, meaning "use my own ID." When set, it points to another persona whose intelligence tables this clone shares. **Only one level of indirection** — the target persona MUST have `intelligence_source_id = NULL`.

**Constraint:**

```sql
CHECK (intelligence_source_id IS NULL OR intelligence_source_id != id)
```

**Helper function** (exported from `lib/knowledge-db.js`, used everywhere):

```javascript
export function getIntelligenceId(persona) {
  return persona.intelligence_source_id || persona.id;
}
```

This is the ONLY change needed at the conceptual level. Every query that currently uses `persona_id` for intelligence data switches to use `getIntelligenceId(persona)` instead.

**Implication:** sharing a clone implicitly grants write access to the source intelligence pool for all users with `persona_shares` access.

### 2. Schema: `contributed_by` on corrections

Add contributor tracking to corrections:

```sql
ALTER TABLE corrections
  ADD COLUMN contributed_by uuid REFERENCES clients(id);
```

This tracks which user created each correction. Existing corrections get `NULL` (legacy, pre-tracking).

Knowledge files already have a `persona_id` scope — we add the same tracking:

```sql
ALTER TABLE knowledge_files
  ADD COLUMN contributed_by uuid REFERENCES clients(id);
```

### 3. Affected Code — Intelligence Reads

All intelligence reads go through `loadPersonaData(personaId)` in `lib/knowledge-db.js`. This is the single point of change for reads.

**Current:** All queries use `personaId` directly.
**New:** Load persona first to get `intelligence_source_id`, then use that for all intelligence queries.

```javascript
async function loadPersonaData(personaId) {
  // Load persona config (always by own ID — voice, scenarios stay personal)
  const persona = await supabase.from("personas").select("*").eq("id", personaId).single();
  
  // Resolve intelligence source
  const intellId = persona.intelligence_source_id || persona.id;
  
  // Intelligence queries use intellId
  const knowledge = await supabase.from("knowledge_files").select("...").eq("persona_id", intellId);
  const corrections = await supabase.from("corrections").select("...").eq("persona_id", intellId);
  const entities = await supabase.from("knowledge_entities").select("...").eq("persona_id", intellId);
  const relations = await supabase.from("knowledge_relations").select("...").eq("persona_id", intellId);
  
  // Scenarios stay personal (per-persona, not shared)
  const scenarios = await supabase.from("scenario_files").select("...").eq("persona_id", personaId);
}
```

**Also affected:**
- `findRelevantEntities()` — the `match_entities` RPC call uses `match_persona_id`. Must pass `intellId`.
- `retrieveChunks()` in `lib/rag.js` — chunk queries filter by `persona_id`. Must pass `intellId`.

**Cache strategy:** Keep cache keyed by `personaId` (not `intellId`) since the cache bundles both personal data (voice, scenarios) and intelligence data. The `loadPersonaData` function resolves `intellId` internally for intelligence queries. On cache invalidation after a write, `clearCache` must invalidate ALL personas sharing the same `intellId`:

```javascript
export async function clearIntelligenceCache(intellId) {
  // Clear the source persona's cache
  delete _cache[intellId];
  // Clear all downstream clones pointing to this source
  for (const key of Object.keys(_cache)) {
    if (_cache[key]?.data?.persona?.intelligence_source_id === intellId) {
      delete _cache[key];
    }
  }
}
```

### 4. Affected Code — Intelligence Writes

Writes happen in:

1. **`api/feedback.js`** — ALL methods (GET, POST, DELETE)
   - **POST** (all types: validate, reject, accept, save_rule, implicit): Insert corrections with `persona_id = intellId`, add `contributed_by = client.id`, pass `intellId` to `extractGraphKnowledge()`
   - **POST validate/reject**: Entity queries (confidence boost, demotion) must use `intellId`
   - **GET**: `loadPersonaData` already resolves `intellId` internally — no change needed
   - **DELETE**: Delete corrections with `.eq("persona_id", intellId)` instead of `personaId`

2. **`lib/feedback-detect.js`** — ALL 5 auto-detection functions (critical, most intelligence writes come from here)
   - `detectDirectInstruction()`: inserts corrections + calls `extractGraphKnowledge` — must use `intellId`
   - `detectCoachingCorrection()`: same pattern
   - `detectChatFeedback()`: same pattern
   - `detectNegativeFeedback()`: queries/updates corrections and demotes entities — must use `intellId`
   - `detectValidation()`: boosts correction confidence — must use `intellId`
   - All receive `personaId` from `chat.js` — callers must pass `intellId` instead

3. **`lib/graph-extraction.js`** — entity/relation extraction
   - Already receives `personaId` as param — callers pass `intellId` instead
   - No internal changes needed

4. **`api/knowledge.js`** — ALL methods (GET, POST, DELETE)
   - **POST**: Insert knowledge_files with `persona_id = intellId`, add `contributed_by = client.id`, pass `intellId` to `embedAndStore()`
   - **GET**: List knowledge files with `.eq("persona_id", intellId)`
   - **DELETE**: Delete knowledge files and chunks with `.eq("persona_id", intellId)`

5. **`lib/embeddings.js`** — `embedAndStore()` inserts chunks with `persona_id`
   - Callers (`api/knowledge.js`, `api/clone.js`) must pass `intellId` instead of `personaId`

6. **Cache invalidation** — use `clearIntelligenceCache(intellId)` which invalidates the source AND all downstream clones.

### 5. Resolving `intellId` in APIs

Each API already loads the persona. We add one step:

```javascript
const persona = await getPersonaFromDb(personaId);
const intellId = persona.intelligence_source_id || persona.id;
```

Then pass `intellId` to all intelligence operations. The persona object itself is still used for voice/scenario config.

### 6. UI: Contributors Panel

**Location:** New section in `SettingsModal.svelte` (currently only shows API key + budget).

**Data source:** New API endpoint `GET /api/contributors?persona_id=X` that returns:

```json
{
  "contributors": [
    { "client_id": "...", "name": "Brahim", "corrections_count": 23, "knowledge_count": 4, "last_active": "2026-04-15" },
    { "client_id": "...", "name": "Abraham", "corrections_count": 8, "knowledge_count": 1, "last_active": "2026-04-16" }
  ],
  "is_shared": true,
  "source_persona_name": "immostate"
}
```

**Query:**
```sql
SELECT 
  c.id, c.name,
  COUNT(DISTINCT cor.id) as corrections_count,
  COUNT(DISTINCT kf.id) as knowledge_count,
  GREATEST(MAX(cor.created_at), MAX(kf.created_at)) as last_active
FROM clients c
LEFT JOIN corrections cor ON cor.contributed_by = c.id AND cor.persona_id = :intellId
LEFT JOIN knowledge_files kf ON kf.contributed_by = c.id AND kf.persona_id = :intellId
WHERE c.id IN (
  SELECT client_id FROM personas WHERE id = :intellId OR intelligence_source_id = :intellId
  UNION
  SELECT client_id FROM persona_shares WHERE persona_id = :intellId
)
GROUP BY c.id, c.name
HAVING COUNT(DISTINCT cor.id) > 0 OR COUNT(DISTINCT kf.id) > 0
```

**UI Component:** Simple list below the budget display:

```
┌─────────────────────────────────┐
│ Contributeurs                   │
│                                 │
│  Brahim    23 corrections, 4 docs│
│  Abraham    8 corrections, 1 doc │
│                                 │
│  Intelligence partagee           │
└─────────────────────────────────┘
```

### 7. What stays personal (NOT shared)

- `personas.voice` — tone, personality, phrases
- `scenario_files` — scenario content
- `personas.scenarios` — scenario config
- `personas.theme` — branding
- `conversations` — chat history

Each clone keeps its own identity. Only the "brain" (what it knows) is shared.

### 8. Migration

Single migration file `supabase/012_shared_intelligence.sql`:

```sql
-- 1. Add intelligence source FK (one level of indirection only, no self-reference)
ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS intelligence_source_id uuid REFERENCES personas(id)
  CHECK (intelligence_source_id IS NULL OR intelligence_source_id != id);

-- 2. Add contributor tracking
ALTER TABLE corrections
  ADD COLUMN IF NOT EXISTS contributed_by uuid REFERENCES clients(id);

ALTER TABLE knowledge_files
  ADD COLUMN IF NOT EXISTS contributed_by uuid REFERENCES clients(id);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_corrections_contributed_by ON corrections(contributed_by);
CREATE INDEX IF NOT EXISTS idx_knowledge_files_contributed_by ON knowledge_files(contributed_by);
CREATE INDEX IF NOT EXISTS idx_personas_intelligence_source ON personas(intelligence_source_id)
  WHERE intelligence_source_id IS NOT NULL;
```

### 9. Setting up shared intelligence

Done manually in Supabase for now (or via a future admin UI):

```sql
UPDATE personas 
SET intelligence_source_id = '<brahim_persona_id>'
WHERE id = '<abraham_persona_id>';
```

No new UI for linking clones — this is an admin/power-user operation for now.

## Files Changed

| File | Change |
|------|--------|
| `supabase/012_shared_intelligence.sql` | New migration |
| `lib/knowledge-db.js` | Export `getIntelligenceId`, `loadPersonaData` resolves `intellId` for intelligence queries, `clearIntelligenceCache` replaces `clearCache` |
| `lib/graph-extraction.js` | No change (callers pass correct ID) |
| `lib/embeddings.js` | No change (callers pass correct ID to `embedAndStore`) |
| `api/chat.js` | Resolve `intellId`, pass to knowledge functions + `feedback-detect` |
| `api/feedback.js` | All methods: resolve `intellId` for reads/writes/deletes + add `contributed_by` |
| `lib/feedback-detect.js` | All 5 detection functions receive `intellId` instead of `personaId` for intelligence ops |
| `api/knowledge.js` | All methods: resolve `intellId` for reads/writes/deletes + add `contributed_by` + pass `intellId` to `embedAndStore` |
| `api/contributors.js` | New endpoint |
| `src/lib/components/SettingsModal.svelte` | Add contributors section (requires new `personaId` prop) |

### Scripts (awareness only, lower priority)

These admin scripts query by `persona_id` and should use `intellId` when run against shared clones:
- `scripts/bootstrap-graph.js`
- `scripts/extract-ontology.js`
- `scripts/embed-entities.js`
- `scripts/sync-knowledge-embeddings.js`

## Non-goals

- No UI for linking clones (admin SQL for now)
- No per-contributor permissions (all shared users can read+write)
- No activity timeline (just counts)
- No separate "intelligence groups" abstraction
- No multi-level indirection (A->B->C); target must have `intelligence_source_id = NULL`

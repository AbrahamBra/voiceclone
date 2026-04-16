# Shared Intelligence Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow multiple clones to share a single intelligence pool (corrections, knowledge graph, embeddings) and track which users contribute.

**Architecture:** Add `intelligence_source_id` FK on `personas` — NULL means "use my own ID", non-NULL points to the source persona. A helper `getIntelligenceId(persona)` resolves the ID. All intelligence reads/writes use this resolved ID. Personal data (voice, scenarios) stays per-clone. New `contributed_by` column tracks who created each correction/knowledge file.

**Tech Stack:** Supabase (PostgreSQL), Node.js API handlers, SvelteKit 5 frontend

**Spec:** `docs/superpowers/specs/2026-04-16-shared-intelligence-design.md`

---

## Chunk 1: Schema + Core Helper

### Task 1: Migration

**Files:**
- Create: `supabase/012_shared_intelligence.sql`

- [ ] **Step 1: Create migration file**

```sql
-- 012: Shared intelligence between clones + contributor tracking

-- 1. Intelligence source FK (one level, no self-reference)
ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS intelligence_source_id uuid REFERENCES personas(id)
  CHECK (intelligence_source_id IS NULL OR intelligence_source_id != id);

-- 2. Contributor tracking
ALTER TABLE corrections
  ADD COLUMN IF NOT EXISTS contributed_by uuid REFERENCES clients(id);

ALTER TABLE knowledge_files
  ADD COLUMN IF NOT EXISTS contributed_by uuid REFERENCES clients(id);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_corrections_contributed_by
  ON corrections(contributed_by);
CREATE INDEX IF NOT EXISTS idx_knowledge_files_contributed_by
  ON knowledge_files(contributed_by);
CREATE INDEX IF NOT EXISTS idx_personas_intelligence_source
  ON personas(intelligence_source_id)
  WHERE intelligence_source_id IS NOT NULL;
```

- [ ] **Step 2: Run migration in Supabase SQL Editor**

- [ ] **Step 3: Commit**

```bash
git add supabase/012_shared_intelligence.sql
git commit -m "feat: add intelligence_source_id + contributed_by columns"
```

### Task 2: Core helper in knowledge-db.js

**Files:**
- Modify: `lib/knowledge-db.js`

The core change: export `getIntelligenceId`, modify `loadPersonaData` to resolve `intellId` for intelligence queries (knowledge, corrections, entities, relations) while keeping scenarios personal. Replace `clearCache` with `clearIntelligenceCache`.

- [ ] **Step 1: Add `getIntelligenceId` export (after imports, before `normalize`)**

```javascript
/**
 * Resolve the intelligence source persona ID.
 * NULL intelligence_source_id means "use my own ID".
 */
export function getIntelligenceId(persona) {
  return persona.intelligence_source_id || persona.id;
}
```

- [ ] **Step 2: Modify `loadPersonaData` — resolve `intellId` for intelligence queries**

Replace `loadPersonaData` function body. Key changes:
- After loading persona, compute `const intellId = getIntelligenceId(persona);`
- Use `intellId` for `knowledge_files`, `corrections`, `knowledge_entities`, `knowledge_relations` queries
- Keep `personaId` for `scenario_files` (personal, not shared)

```javascript
async function loadPersonaData(personaId) {
  const now = Date.now();
  if (_cache[personaId] && now - _cache[personaId].ts < CACHE_TTL) {
    return _cache[personaId].data;
  }

  const { data: persona, error: pErr } = await supabase
    .from("personas").select("*").eq("id", personaId).single();
  if (pErr || !persona) return null;

  // Resolve intelligence source (NULL = own ID)
  const intellId = getIntelligenceId(persona);

  // Intelligence data uses intellId (shared pool)
  const { data: knowledge } = await supabase
    .from("knowledge_files").select("path, keywords, content").eq("persona_id", intellId);

  // Scenarios stay personal (per-clone)
  const { data: scenarios } = await supabase
    .from("scenario_files").select("slug, content").eq("persona_id", personaId);

  const { data: corrections } = await supabase
    .from("corrections").select("id, correction, user_message, bot_message, confidence, status, created_at")
    .eq("persona_id", intellId).order("created_at", { ascending: true });

  let entities = [];
  let relations = [];
  try {
    const { data: ent } = await supabase
      .from("knowledge_entities").select("id, name, type, description, confidence, last_matched_at")
      .eq("persona_id", intellId);
    entities = ent || [];

    if (entities.length > 0) {
      const { data: rel } = await supabase
        .from("knowledge_relations")
        .select("from_entity_id, to_entity_id, relation_type, description, confidence")
        .eq("persona_id", intellId);
      relations = rel || [];
    }
  } catch { /* tables may not exist yet */ }

  const result = {
    persona,
    knowledge: (knowledge || []).map((k) => ({
      ...k, keywords: (k.keywords || []).map(normalize),
    })),
    scenarios: scenarios || [],
    corrections: corrections || [],
    entities,
    relations,
  };

  _cache[personaId] = { ts: now, data: result };
  return result;
}
```

- [ ] **Step 3: Replace `clearCache` with `clearIntelligenceCache`**

Replace the existing `clearCache` export:

```javascript
/**
 * Clear cache for a persona AND all downstream clones sharing its intelligence.
 * Call with intellId after writes to the shared pool.
 */
export function clearIntelligenceCache(intellId) {
  delete _cache[intellId];
  for (const key of Object.keys(_cache)) {
    if (_cache[key]?.data?.persona?.intelligence_source_id === intellId) {
      delete _cache[key];
    }
  }
}

// Backward compat alias
export { clearIntelligenceCache as clearCache };
```

- [ ] **Step 4: Update `findRelevantEntities` — pass `intellId` to `match_entities` RPC**

At `lib/knowledge-db.js:142`, the function receives `personaId` but needs `intellId` for the RPC call. Since `loadPersonaData` is already called, extract `intellId` from the cached persona:

```javascript
export async function findRelevantEntities(personaId, messages) {
  const data = await loadPersonaData(personaId);
  if (!data || data.entities.length === 0) return { entities: [], relations: [], boostTerms: [] };

  const intellId = getIntelligenceId(data.persona);
  // ... rest stays the same, but replace the RPC call's match_persona_id:
```

In the RPC call at line 161, change `match_persona_id: personaId` to `match_persona_id: intellId`.

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge-db.js
git commit -m "feat: resolve intellId in knowledge-db for shared intelligence"
```

---

## Chunk 2: API Write Paths (feedback.js, feedback-detect.js)

### Task 3: api/feedback.js — all methods use intellId + contributed_by

**Files:**
- Modify: `api/feedback.js`

- [ ] **Step 1: Update imports**

Replace `clearCache` with `clearIntelligenceCache` and add `getIntelligenceId`:

```javascript
import { clearIntelligenceCache, loadPersonaData, getIntelligenceId } from "../lib/knowledge-db.js";
```

Note: also import `getPersonaFromDb` if needed, but `loadPersonaData` already provides persona data.

- [ ] **Step 2: Add intellId resolution after access check in POST handler**

After line 124 (the access check block for POST), add persona loading + intellId resolution. This replaces all uses of `personaId` for intelligence operations:

```javascript
  // Resolve intelligence source for writes
  const { data: feedbackPersona } = await supabase
    .from("personas").select("id, intelligence_source_id").eq("id", personaId).single();
  if (!feedbackPersona) { res.status(404).json({ error: "Persona not found" }); return; }
  const intellId = getIntelligenceId(feedbackPersona);
```

- [ ] **Step 3: Update "validate" type (line 127-157)**

Replace all `persona_id: personaId` with `persona_id: intellId` in:
- Correction insert (line 131): `persona_id: intellId`
- Add `contributed_by: client?.id || null` to the insert
- Entity query (line 142): `.eq("persona_id", intellId)`
- `clearIntelligenceCache(intellId)` replaces `clearCache(personaId)` (line 155)

- [ ] **Step 4: Update "reject" type (line 162-206)**

- Entity query (line 177): `.eq("persona_id", intellId)` instead of `personaId`
- Correction query (line 193): `.eq("persona_id", intellId)` instead of `personaId`
- `clearIntelligenceCache(intellId)` (line 204)

- [ ] **Step 5: Update "accept" type (line 251-269)**

- Correction insert (line 255): `persona_id: intellId`, add `contributed_by: client?.id || null`
- `extractGraphKnowledge(intellId, ...)` (line 264)
- `clearIntelligenceCache(intellId)` (line 266)

- [ ] **Step 6: Update "save_rule" type (line 272-312)**

- Correction insert (line 297-301): `persona_id: intellId`, add `contributed_by: client?.id || null`
- `extractGraphKnowledge(intellId, ...)` (line 304)
- `clearIntelligenceCache(intellId)` (line 305)

- [ ] **Step 7: Update "implicit" type + default POST (line 314-367)**

- Correction insert (line 344): `persona_id: intellId`, add `contributed_by: client?.id || null`
- `extractGraphKnowledge(intellId, ...)` (line 357)
- `clearIntelligenceCache(intellId)` (line 359)

- [ ] **Step 8: Update DELETE handler (line 90-112)**

- Add intellId resolution (same pattern: load persona, `getIntelligenceId`)
- Delete query (line 105-106): `.eq("persona_id", intellId)` instead of `personaId`
- `clearIntelligenceCache(intellId)` (line 110)

- [ ] **Step 9: Commit**

```bash
git add api/feedback.js
git commit -m "feat: feedback.js uses intellId + contributed_by for shared intelligence"
```

### Task 4: lib/feedback-detect.js — all functions use intellId

**Files:**
- Modify: `lib/feedback-detect.js`

All 5 exported functions currently receive `personaId` as first arg. We rename to `intellId` since callers (chat.js) will pass the resolved intelligence ID.

- [ ] **Step 1: Update import**

Replace `clearCache` with `clearIntelligenceCache`:

```javascript
import { clearIntelligenceCache } from "./knowledge-db.js";
```

- [ ] **Step 2: Update `detectNegativeFeedback`**

- Rename first param from `personaId` to `intellId`
- Correction query (line 63): `.eq("persona_id", intellId)`
- Entity query (line 117): `.eq("persona_id", intellId)`
- `clearIntelligenceCache(intellId)` (line 133)
- Logs: keep `persona: intellId` for tracing

- [ ] **Step 3: Update `detectDirectInstruction`**

- Rename first param from `personaId` to `intellId`
- Correction insert (line 257-261): `persona_id: intellId`
- `extractGraphKnowledge(intellId, ...)` (line 264)
- `clearIntelligenceCache(intellId)` (line 268)

- [ ] **Step 4: Update `detectCoachingCorrection`**

- Rename first param from `personaId` to `intellId`
- Correction insert (line 334-338): `persona_id: intellId`
- `extractGraphKnowledge(intellId, ...)` (line 341)
- `clearIntelligenceCache(intellId)` (line 342)

- [ ] **Step 5: Update `detectChatFeedback`**

- Rename first param from `personaId` to `intellId`
- Correction insert (line 416-420): `persona_id: intellId`
- `extractGraphKnowledge(intellId, ...)` (line 423)
- `clearIntelligenceCache(intellId)` (line 427)

- [ ] **Step 6: Commit**

```bash
git add lib/feedback-detect.js
git commit -m "feat: feedback-detect uses intellId for shared intelligence writes"
```

---

## Chunk 3: API Write Paths (chat.js, knowledge.js)

### Task 5: api/chat.js — resolve intellId, pass to all intelligence functions

**Files:**
- Modify: `api/chat.js`

- [ ] **Step 1: Update import**

Add `getIntelligenceId`:

```javascript
import { getPersonaFromDb, findRelevantKnowledgeFromDb, loadScenarioFromDb, getCorrectionsFromDb, findRelevantEntities, getIntelligenceId } from "../lib/knowledge-db.js";
```

- [ ] **Step 2: Resolve intellId after persona load (line 61-62)**

After loading persona, add:

```javascript
  const intellId = getIntelligenceId(persona);
```

- [ ] **Step 3: Pass intellId to detectNegativeFeedback (line 152)**

Change:
```javascript
const result = await detectNegativeFeedback(personaId, message, messages, client);
```
To:
```javascript
const result = await detectNegativeFeedback(intellId, message, messages, client);
```

- [ ] **Step 4: Pass intellId to detectDirectInstruction (line 186)**

Change `detectDirectInstruction(personaId, ...)` to `detectDirectInstruction(intellId, ...)`.

- [ ] **Step 5: Pass intellId to detectCoachingCorrection and detectChatFeedback (line 253-254)**

Change both calls from `personaId` to `intellId`:
```javascript
    Promise.all([
      detectCoachingCorrection(intellId, message, messages, client),
      detectChatFeedback(intellId, message, messages, client),
    ])
```

- [ ] **Step 6: Commit**

```bash
git add api/chat.js
git commit -m "feat: chat.js resolves intellId for all intelligence operations"
```

Note: `findRelevantEntities(personaId, ...)`, `findRelevantKnowledgeFromDb(personaId, ...)`, `getCorrectionsFromDb(personaId)` still receive `personaId` — they resolve `intellId` internally via `loadPersonaData`. No change needed for reads.

### Task 6: api/knowledge.js — all methods use intellId + contributed_by

**Files:**
- Modify: `api/knowledge.js`

- [ ] **Step 1: Update imports**

```javascript
import { clearIntelligenceCache, getIntelligenceId } from "../lib/knowledge-db.js";
```

(Remove `clearCache` import.)

- [ ] **Step 2: Update GET handler (line 58-96)**

After access check, resolve intellId:

```javascript
    const { data: getPersona } = await supabase
      .from("personas").select("id, intelligence_source_id").eq("id", personaId).single();
    if (!getPersona) { res.status(404).json({ error: "Persona not found" }); return; }
    const intellId = getIntelligenceId(getPersona);
```

Then use `intellId` in queries:
- Line 70: `.eq("persona_id", intellId)`
- Line 79: `.eq("persona_id", intellId)`

- [ ] **Step 3: Update DELETE handler (line 99-127)**

Resolve intellId after persona ownership check, then:
- Line 116: `.eq("persona_id", intellId)`
- Line 121: `.eq("persona_id", intellId)`
- Line 124: `clearIntelligenceCache(intellId)`

- [ ] **Step 4: Update POST handler (line 129-204)**

Resolve intellId after persona ownership check (after line 144):

```javascript
    const intellId = getIntelligenceId(persona);
```

Wait — the POST handler loads `persona` for ownership check but doesn't select `intelligence_source_id`. Update the select at line 141:
```javascript
    const { data: persona } = await supabase
      .from("personas").select("client_id, intelligence_source_id").eq("id", personaId).single();
```

Then:
- Line 180: `embedAndStore(supabase, chunks, intellId, "knowledge_file", path)`
- Line 186-191: `persona_id: intellId`, add `contributed_by: client?.id || null`
- Line 197: `clearIntelligenceCache(intellId)`
- Line 201: `extractGraphKnowledgeFromFile(intellId, content, client)`

- [ ] **Step 5: Update `extractGraphKnowledgeFromFile` (line 211-316)**

Rename param from `personaId` to `intellId`. All internal queries already use the param, so just rename:
- Line 222: `.eq("persona_id", intellId)` (already uses personaId param)
- Line 262: `persona_id: intellId`
- Line 282: `.eq("persona_id", intellId)`
- Line 290: `persona_id: intellId`
- Line 306: `.eq("persona_id", intellId).eq("name", upd.name)`

- [ ] **Step 6: Commit**

```bash
git add api/knowledge.js
git commit -m "feat: knowledge.js uses intellId + contributed_by for shared intelligence"
```

---

## Chunk 4: Contributors API + UI

### Task 7: api/contributors.js — new endpoint

**Files:**
- Create: `api/contributors.js`

- [ ] **Step 1: Create the endpoint**

```javascript
import { authenticateRequest, supabase, hasPersonaAccess, setCors } from "../lib/supabase.js";
import { getIntelligenceId } from "../lib/knowledge-db.js";

export default async function handler(req, res) {
  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const personaId = req.query?.persona;
  if (!personaId) { res.status(400).json({ error: "persona is required" }); return; }

  if (!isAdmin) {
    const hasAccess = await hasPersonaAccess(client?.id, personaId);
    if (!hasAccess) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  // Load persona to resolve intelligence source
  const { data: persona } = await supabase
    .from("personas").select("id, name, intelligence_source_id").eq("id", personaId).single();
  if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

  const intellId = getIntelligenceId(persona);
  const isShared = intellId !== persona.id;

  // Get source persona name if shared
  let sourcePersonaName = null;
  if (isShared) {
    const { data: source } = await supabase
      .from("personas").select("name").eq("id", intellId).single();
    sourcePersonaName = source?.name || null;
  }

  // Count contributions per client
  const { data: corrCounts } = await supabase
    .from("corrections")
    .select("contributed_by")
    .eq("persona_id", intellId)
    .not("contributed_by", "is", null);

  const { data: knowledgeCounts } = await supabase
    .from("knowledge_files")
    .select("contributed_by")
    .eq("persona_id", intellId)
    .not("contributed_by", "is", null);

  // Aggregate by client
  const stats = {};
  for (const row of (corrCounts || [])) {
    if (!row.contributed_by) continue;
    if (!stats[row.contributed_by]) stats[row.contributed_by] = { corrections: 0, knowledge: 0 };
    stats[row.contributed_by].corrections++;
  }
  for (const row of (knowledgeCounts || [])) {
    if (!row.contributed_by) continue;
    if (!stats[row.contributed_by]) stats[row.contributed_by] = { corrections: 0, knowledge: 0 };
    stats[row.contributed_by].knowledge++;
  }

  // Fetch client names
  const clientIds = Object.keys(stats);
  if (clientIds.length === 0) {
    res.json({ contributors: [], is_shared: isShared, source_persona_name: sourcePersonaName });
    return;
  }

  const { data: clients } = await supabase
    .from("clients").select("id, name").in("id", clientIds);

  const nameMap = {};
  for (const c of (clients || [])) nameMap[c.id] = c.name;

  const contributors = clientIds.map(id => ({
    client_id: id,
    name: nameMap[id] || "Inconnu",
    corrections_count: stats[id].corrections,
    knowledge_count: stats[id].knowledge,
  })).sort((a, b) => (b.corrections_count + b.knowledge_count) - (a.corrections_count + a.knowledge_count));

  res.json({ contributors, is_shared: isShared, source_persona_name: sourcePersonaName });
}
```

- [ ] **Step 2: Commit**

```bash
git add api/contributors.js
git commit -m "feat: add contributors API endpoint"
```

### Task 8: SettingsModal.svelte — add contributors section

**Files:**
- Modify: `src/lib/components/SettingsModal.svelte`

- [ ] **Step 1: Add `personaId` prop and contributor state/fetch**

Update the `<script>` block — add `personaId` prop, contributor state, and fetch function:

```javascript
  let { onclose, personaId = null } = $props();

  // ... existing state ...

  let contributors = $state({ contributors: [], is_shared: false, source_persona_name: null });

  $effect(() => {
    fetchUsage();
    if (personaId) fetchContributors();
  });

  async function fetchContributors() {
    try {
      const resp = await fetch(`/api/contributors?persona=${personaId}`, { headers: authHeaders() });
      if (resp.ok) contributors = await resp.json();
    } catch {}
  }
```

- [ ] **Step 2: Add contributors section in the template**

After the `<div class="field">` block (the API key input), before `<div class="actions">`:

```svelte
    {#if contributors.contributors.length > 0 || contributors.is_shared}
      <div class="contributors">
        <h4>Contributeurs{contributors.is_shared ? ` · ${contributors.source_persona_name || "partage"}` : ""}</h4>
        {#if contributors.contributors.length > 0}
          <ul>
            {#each contributors.contributors as c}
              <li>
                <span class="name">{c.name}</span>
                <span class="stats">{c.corrections_count} corrections{c.knowledge_count > 0 ? `, ${c.knowledge_count} docs` : ""}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty">Aucune contribution trackee</p>
        {/if}
        {#if contributors.is_shared}
          <p class="shared-badge">Intelligence partagee</p>
        {/if}
      </div>
    {/if}
```

- [ ] **Step 3: Add styles**

Add to the `<style>` block:

```css
  .contributors {
    margin-bottom: 0.75rem;
    padding: 0.5rem;
    background: var(--bg);
    border-radius: var(--radius);
    border: 1px solid var(--border);
  }

  .contributors h4 {
    margin: 0 0 0.375rem;
    font-size: 0.8125rem;
    color: var(--text);
  }

  .contributors ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .contributors li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.2rem 0;
    font-size: 0.75rem;
  }

  .contributors .name {
    color: var(--text);
    font-weight: 500;
  }

  .contributors .stats {
    color: var(--text-secondary);
  }

  .contributors .empty {
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin: 0;
  }

  .shared-badge {
    font-size: 0.6875rem;
    color: var(--accent);
    margin: 0.375rem 0 0;
    font-weight: 500;
  }
```

- [ ] **Step 4: Pass personaId from parent**

In `src/routes/chat/[persona]/+page.svelte`, update the SettingsModal usage (line 448):

```svelte
    <SettingsModal onclose={() => (showSettings = false)} personaId={$page.data.personaId} />
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/SettingsModal.svelte src/routes/chat/[persona]/+page.svelte
git commit -m "feat: show contributors in settings modal"
```

---

## Chunk 5: Verify + Deploy

### Task 9: Manual verification

- [ ] **Step 1: Set up shared intelligence in Supabase**

Find Brahim's immostate persona ID and Abraham's persona ID, then run:
```sql
UPDATE personas
SET intelligence_source_id = '<brahim_persona_id>'
WHERE id = '<abraham_persona_id>';
```

- [ ] **Step 2: Test reads — chat with Abraham's clone**

Send a message. Verify the bot uses Brahim's corrections/knowledge (check logs for entity matches).

- [ ] **Step 3: Test writes — give a correction via Abraham's clone**

Send a coaching correction (e.g. "trop long"). Verify:
- Correction saved with `persona_id = brahim_persona_id` (intellId)
- Correction has `contributed_by = abraham_client_id`

- [ ] **Step 4: Test contributors API**

```
GET /api/contributors?persona=<abraham_persona_id>
```

Verify it returns contributor list with counts.

- [ ] **Step 5: Test UI — open Settings modal**

Verify contributors section appears with names and stats.

- [ ] **Step 6: Deploy**

```bash
git push
```

# Persona Intelligence Panel — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Intelligence tab to the chat sidebar showing corrections (with delete), knowledge entities grouped by type, and learning stats for the current persona.

**Architecture:** Extend `api/feedback.js` with GET + DELETE handlers. Export `loadPersonaData()` from `knowledge-db.js` to reuse cached data. Add `IntelligencePanel.svelte` component mounted inside `ConversationSidebar.svelte` via tab switcher. Svelte 5 runes syntax throughout.

**Tech Stack:** Svelte 5 (runes), existing Supabase backend, existing `$lib/api.js` wrapper

**Spec:** `docs/superpowers/specs/2026-04-15-persona-intelligence-design.md`

**Dependency:** This plan assumes `ConversationSidebar.svelte` exists (Task 8 of `docs/superpowers/plans/2026-04-15-ui-revolution.md`). If it doesn't exist yet, create a minimal placeholder first, then the Intelligence panel. The plan handles both cases.

---

## Chunk 1: Backend — Extend feedback.js + Export loadPersonaData

### Task 1: Export loadPersonaData + Add `id` to corrections select

**Files:**
- Modify: `lib/knowledge-db.js:13-64` (loadPersonaData function)
- Modify: `lib/knowledge-db.js:233` (exports)

- [ ] **Step 1: Add `id` to corrections select in loadPersonaData**

In `lib/knowledge-db.js`, line 30, change:
```js
// Before:
.select("correction, user_message, bot_message, created_at")

// After:
.select("id, correction, user_message, bot_message, created_at")
```

- [ ] **Step 2: Export loadPersonaData**

At the bottom of `lib/knowledge-db.js`, add `loadPersonaData` to the existing exports. The function is currently module-private. Simply add:

```js
export { loadPersonaData };
```

Or rename the function declaration to `export async function loadPersonaData(...)`.

- [ ] **Step 3: Verify no regressions**

`loadPersonaData` is called internally by `getPersonaFromDb`, `findRelevantKnowledgeFromDb`, `findRelevantEntities`, `loadScenarioFromDb`, `getCorrectionsFromDb`. Adding `id` to the corrections select doesn't break any of these — they read `correction`, `user_message`, `bot_message`, `created_at` fields, and the extra `id` field is ignored.

- [ ] **Step 4: Commit**

```bash
git add lib/knowledge-db.js
git commit -m "feat: export loadPersonaData + add id to corrections select"
```

---

### Task 2: Add GET + DELETE handlers to feedback.js

**Files:**
- Modify: `api/feedback.js`

- [ ] **Step 1: Update CORS to accept GET, POST, DELETE**

Line 26, change:
```js
// Before:
setCors(res, "POST, OPTIONS");

// After:
setCors(res, "GET, POST, DELETE, OPTIONS");
```

- [ ] **Step 2: Update method check to route GET, POST, DELETE**

Replace lines 27-28:
```js
// Before:
if (req.method === "OPTIONS") { res.status(200).end(); return; }
if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

// After:
if (req.method === "OPTIONS") { res.status(200).end(); return; }
if (!["GET", "POST", "DELETE"].includes(req.method)) {
  res.status(405).json({ error: "Method not allowed" }); return;
}
```

- [ ] **Step 3: Add import for loadPersonaData**

Line 2, change:
```js
// Before:
import { clearCache } from "../lib/knowledge-db.js";

// After:
import { clearCache, loadPersonaData } from "../lib/knowledge-db.js";
```

- [ ] **Step 4: Add GET handler at the top of the handler function**

After the auth block (line 36), add the GET handler before the existing POST logic:

```js
// ── GET: Intelligence data ──
if (req.method === "GET") {
  const personaId = req.query?.persona;
  if (!personaId) { res.status(400).json({ error: "persona is required" }); return; }

  // Ownership check
  if (!isAdmin) {
    const { data: persona } = await supabase
      .from("personas").select("client_id").eq("id", personaId).single();
    if (!persona || persona.client_id !== client?.id) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }

  const data = await loadPersonaData(personaId);
  if (!data) { res.status(404).json({ error: "Persona not found" }); return; }

  // Build entity-relation map
  const entityMap = {};
  for (const e of data.entities) entityMap[e.id] = e.name;

  const entities = data.entities.map(e => ({
    id: e.id,
    name: e.name,
    type: e.type,
    description: e.description,
    confidence: e.confidence,
    last_matched_at: e.last_matched_at,
    relations: data.relations
      .filter(r => r.from_entity_id === e.id)
      .map(r => ({
        type: r.relation_type,
        target: entityMap[r.to_entity_id] || "?",
        confidence: r.confidence,
      })),
  }));

  const confidences = entities.map(e => e.confidence || 1.0);
  const confidenceAvg = confidences.length > 0
    ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100
    : 0;

  // Corrections: most recent first, limit 50
  const corrections = [...data.corrections]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 50);

  res.json({
    stats: {
      corrections_total: data.corrections.length,
      entities_total: entities.length,
      relations_total: data.relations.length,
      confidence_avg: confidenceAvg,
    },
    corrections,
    entities,
  });
  return;
}
```

- [ ] **Step 5: Add DELETE handler**

After the GET handler, before the existing POST logic:

```js
// ── DELETE: Remove a correction ──
if (req.method === "DELETE") {
  const personaId = req.query?.persona;
  const correctionId = req.query?.correction;
  if (!personaId || !correctionId) {
    res.status(400).json({ error: "persona and correction are required" }); return;
  }

  // Ownership check
  if (!isAdmin) {
    const { data: persona } = await supabase
      .from("personas").select("client_id").eq("id", personaId).single();
    if (!persona || persona.client_id !== client?.id) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }

  const { error } = await supabase
    .from("corrections")
    .delete()
    .eq("id", correctionId)
    .eq("persona_id", personaId); // double-check ownership

  if (error) { res.status(500).json({ error: "Failed to delete" }); return; }

  clearCache(personaId);
  res.json({ ok: true });
  return;
}
```

- [ ] **Step 6: Test GET endpoint manually**

```bash
curl -H "x-access-code: YOUR_CODE" "http://localhost:3000/api/feedback?persona=PERSONA_ID&view=intelligence"
```

Verify response contains `stats`, `corrections`, `entities` with expected shapes.

- [ ] **Step 7: Test DELETE endpoint manually**

```bash
curl -X DELETE -H "x-access-code: YOUR_CODE" "http://localhost:3000/api/feedback?persona=PERSONA_ID&correction=CORRECTION_ID"
```

Verify response is `{ ok: true }` and correction is gone from DB.

- [ ] **Step 8: Commit**

```bash
git add api/feedback.js
git commit -m "feat: add GET/DELETE intelligence handlers to feedback endpoint"
```

---

## Chunk 2: Frontend — IntelligencePanel Svelte Component

### Task 3: Create IntelligencePanel.svelte

**Files:**
- Create: `src/lib/components/IntelligencePanel.svelte`

This is the main panel component. It receives `personaId` as a prop, fetches intelligence data, and renders 3 sections: stats, corrections, entities.

- [ ] **Step 1: Create the component file**

Create `src/lib/components/IntelligencePanel.svelte`:

```svelte
<script>
  import { api } from "$lib/api.js";
  import { getRelativeTime } from "$lib/utils.js";
  import { showToast } from "$lib/stores/ui.js";

  let { personaId } = $props();

  let data = $state(null);
  let loading = $state(true);
  let error = $state(null);
  let expandedCorrections = $state(new Set());
  let expandedEntities = $state(new Set());
  let confirmingDelete = $state(null); // correction id awaiting confirm

  const ENTITY_TYPE_ORDER = ["concept", "framework", "tool", "person", "company", "metric", "belief"];

  $effect(() => {
    if (personaId) loadData();
  });

  async function loadData() {
    loading = true;
    error = null;
    try {
      data = await api(`/api/feedback?persona=${personaId}`);
    } catch (e) {
      error = e.message || "Erreur de chargement";
    } finally {
      loading = false;
    }
  }

  function toggleCorrection(id) {
    const next = new Set(expandedCorrections);
    next.has(id) ? next.delete(id) : next.add(id);
    expandedCorrections = next;
  }

  function toggleEntity(id) {
    const next = new Set(expandedEntities);
    next.has(id) ? next.delete(id) : next.add(id);
    expandedEntities = next;
  }

  function startDelete(id) {
    confirmingDelete = id;
    setTimeout(() => { if (confirmingDelete === id) confirmingDelete = null; }, 4000);
  }

  async function confirmDelete(id) {
    try {
      await api(`/api/feedback?persona=${personaId}&correction=${id}`, { method: "DELETE" });
      data.corrections = data.corrections.filter(c => c.id !== id);
      data.stats.corrections_total--;
      confirmingDelete = null;
      showToast("Correction supprimee");
    } catch {
      showToast("Erreur lors de la suppression");
      confirmingDelete = null;
    }
  }

  let groupedEntities = $derived.by(() => {
    if (!data?.entities) return [];
    return ENTITY_TYPE_ORDER
      .map(type => ({
        type,
        items: data.entities.filter(e => e.type === type),
      }))
      .filter(g => g.items.length > 0);
  });

  function confidenceColor(c) {
    if (c >= 0.8) return "var(--success)";
    if (c >= 0.6) return "var(--warning)";
    return "var(--error)";
  }
</script>

{#if loading}
  <div class="intel-loading">Chargement...</div>
{:else if error}
  <div class="intel-error">
    {error}
    <button class="intel-retry" onclick={loadData}>Reessayer</button>
  </div>
{:else if data}
  <!-- Stats -->
  <div class="intel-stats">
    <div class="intel-stat">
      <span class="intel-stat-value">{data.stats.corrections_total}</span>
      <span class="intel-stat-label">corrections</span>
    </div>
    <div class="intel-stat">
      <span class="intel-stat-value">{data.stats.entities_total}</span>
      <span class="intel-stat-label">entites</span>
    </div>
    <div class="intel-stat">
      <span class="intel-stat-value">{data.stats.confidence_avg}</span>
      <span class="intel-stat-label">confiance</span>
    </div>
  </div>

  <!-- Corrections -->
  <div class="intel-section">
    <h4 class="intel-section-title">Corrections <span class="intel-count">{data.corrections.length}</span></h4>
    {#if data.corrections.length === 0}
      <p class="intel-empty">Aucune correction. Utilisez le bouton Corriger sur les reponses.</p>
    {:else}
      {#each data.corrections as c (c.id)}
        <div class="intel-correction" class:expanded={expandedCorrections.has(c.id)}>
          <div class="intel-correction-header" onclick={() => toggleCorrection(c.id)}>
            <span class="intel-correction-date">{getRelativeTime(c.created_at)}</span>
            <span class="intel-correction-text">
              {c.correction.length > 80 ? c.correction.slice(0, 80) + "..." : c.correction}
            </span>
            {#if confirmingDelete === c.id}
              <button class="intel-delete-btn confirming" onclick={(e) => { e.stopPropagation(); confirmDelete(c.id); }}>
                Supprimer ?
              </button>
            {:else}
              <button class="intel-delete-btn" onclick={(e) => { e.stopPropagation(); startDelete(c.id); }}>
                &times;
              </button>
            {/if}
          </div>
          {#if expandedCorrections.has(c.id)}
            <div class="intel-correction-detail">
              {#if c.correction.length > 80}
                <p class="intel-correction-full">{c.correction}</p>
              {/if}
              {#if c.user_message}
                <p class="intel-context">User: {c.user_message}</p>
              {/if}
              {#if c.bot_message}
                <p class="intel-context">Bot: {c.bot_message}</p>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <!-- Entities -->
  <div class="intel-section">
    <h4 class="intel-section-title">Connaissances <span class="intel-count">{data.entities.length}</span></h4>
    {#if data.entities.length === 0}
      <p class="intel-empty">Aucune entite. Le graphe se construit automatiquement via les corrections.</p>
    {:else}
      {#each groupedEntities as group}
        <div class="intel-entity-group">
          <span class="intel-group-label">{group.type}</span>
          {#each group.items as e (e.id)}
            <div class="intel-entity" onclick={() => toggleEntity(e.id)}>
              <div class="intel-entity-header">
                <span class="intel-entity-name">{e.name}</span>
                <div class="intel-confidence-bar">
                  <div
                    class="intel-confidence-fill"
                    style="width: {(e.confidence || 1) * 100}%; background: {confidenceColor(e.confidence || 1)}"
                  ></div>
                </div>
                {#if e.last_matched_at}
                  <span class="intel-entity-used">{getRelativeTime(e.last_matched_at)}</span>
                {/if}
              </div>
              {#if expandedEntities.has(e.id)}
                <div class="intel-entity-detail">
                  {#if e.description}
                    <p class="intel-entity-desc">{e.description}</p>
                  {/if}
                  {#if e.relations.length > 0}
                    <ul class="intel-relations">
                      {#each e.relations as r}
                        <li>{r.type} {r.target} <span class="intel-rel-conf">({r.confidence})</span></li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .intel-loading, .intel-error {
    padding: 1rem;
    color: var(--text-secondary);
    font-size: 0.75rem;
    text-align: center;
  }
  .intel-retry {
    display: block;
    margin: 0.5rem auto 0;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text-secondary);
    padding: 0.25rem 0.5rem;
    font-size: 0.6875rem;
    cursor: pointer;
  }
  .intel-retry:hover { color: var(--text); border-color: var(--text-tertiary); }

  /* Stats */
  .intel-stats {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--border);
  }
  .intel-stat {
    flex: 1;
    text-align: center;
  }
  .intel-stat-value {
    display: block;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text);
  }
  .intel-stat-label {
    font-size: 0.625rem;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  /* Sections */
  .intel-section {
    padding: 0.5rem;
  }
  .intel-section-title {
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.5rem;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .intel-count {
    font-size: 0.625rem;
    color: var(--text-tertiary);
    font-weight: 400;
  }
  .intel-empty {
    font-size: 0.6875rem;
    color: var(--text-tertiary);
    padding: 0.5rem;
    margin: 0;
  }

  /* Corrections */
  .intel-correction {
    border-radius: var(--radius);
    margin-bottom: 2px;
    transition: background 0.1s;
  }
  .intel-correction:hover { background: rgba(255, 255, 255, 0.03); }
  .intel-correction-header {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.5rem;
    cursor: pointer;
    font-size: 0.6875rem;
  }
  .intel-correction-date {
    color: var(--text-tertiary);
    font-size: 0.625rem;
    flex-shrink: 0;
    min-width: 3.5rem;
  }
  .intel-correction-text {
    color: var(--text-secondary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .intel-delete-btn {
    background: transparent;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: 0.75rem;
    padding: 0 0.25rem;
    flex-shrink: 0;
    transition: color 0.15s;
  }
  .intel-delete-btn:hover { color: var(--error); }
  .intel-delete-btn.confirming {
    color: var(--error);
    font-size: 0.625rem;
  }
  .intel-correction-detail {
    padding: 0.25rem 0.5rem 0.5rem 4.25rem;
  }
  .intel-correction-full {
    color: var(--text);
    font-size: 0.6875rem;
    margin: 0 0 0.375rem;
  }
  .intel-context {
    color: var(--text-tertiary);
    font-size: 0.625rem;
    margin: 0.125rem 0;
    font-style: italic;
  }

  /* Entities */
  .intel-entity-group {
    margin-bottom: 0.5rem;
  }
  .intel-group-label {
    font-size: 0.5625rem;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.25rem 0.5rem;
    display: block;
  }
  .intel-entity {
    border-radius: var(--radius);
    cursor: pointer;
    transition: background 0.1s;
  }
  .intel-entity:hover { background: rgba(255, 255, 255, 0.03); }
  .intel-entity-header {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.3rem 0.5rem;
    font-size: 0.6875rem;
  }
  .intel-entity-name {
    color: var(--text);
    font-weight: 500;
    flex-shrink: 0;
  }
  .intel-confidence-bar {
    flex: 1;
    height: 3px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
    min-width: 2rem;
  }
  .intel-confidence-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.3s;
  }
  .intel-entity-used {
    color: var(--text-tertiary);
    font-size: 0.5625rem;
    flex-shrink: 0;
  }
  .intel-entity-detail {
    padding: 0.125rem 0.5rem 0.375rem;
  }
  .intel-entity-desc {
    font-size: 0.6875rem;
    color: var(--text-secondary);
    margin: 0 0 0.25rem;
  }
  .intel-relations {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .intel-relations li {
    font-size: 0.625rem;
    color: var(--text-tertiary);
    padding: 0.0625rem 0;
  }
  .intel-rel-conf { opacity: 0.6; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/IntelligencePanel.svelte
git commit -m "feat: IntelligencePanel component — stats, corrections, entities"
```

---

### Task 4: Add tab switcher to ConversationSidebar

**Files:**
- Modify (or create): `src/lib/components/ConversationSidebar.svelte`

**If `ConversationSidebar.svelte` already exists** (Task 8 of ui-revolution was completed):

- [ ] **Step 1: Add tab state and import**

At the top of the `<script>` block, add:

```js
import IntelligencePanel from "./IntelligencePanel.svelte";

let activeTab = $state("conversations"); // "conversations" | "intelligence"
```

- [ ] **Step 2: Add tab switcher UI**

In the sidebar header (`.conv-sidebar-header`), add tab buttons above or replacing the existing header content:

```svelte
<div class="sidebar-tabs">
  <button
    class="sidebar-tab"
    class:active={activeTab === "conversations"}
    onclick={() => activeTab = "conversations"}
  >Conversations</button>
  <button
    class="sidebar-tab"
    class:active={activeTab === "intelligence"}
    onclick={() => activeTab = "intelligence"}
  >Intelligence</button>
</div>
```

- [ ] **Step 3: Wrap existing content in tab conditional**

Wrap the existing conversation list (`.conv-list` or equivalent) with:

```svelte
{#if activeTab === "conversations"}
  <!-- existing conversation list content here -->
{:else}
  <IntelligencePanel {personaId} />
{/if}
```

`personaId` should already be available as a prop of ConversationSidebar.

- [ ] **Step 4: Add tab styles**

In the `<style>` block, add:

```css
.sidebar-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
}
.sidebar-tab {
  flex: 1;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  font-weight: 500;
  padding: 0.5rem 0;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  font-family: inherit;
}
.sidebar-tab:hover { color: var(--text-secondary); }
.sidebar-tab.active {
  color: var(--text);
  border-bottom-color: var(--accent);
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/ConversationSidebar.svelte
git commit -m "feat: add Intelligence tab to conversation sidebar"
```

---

**If `ConversationSidebar.svelte` does NOT exist yet** (Task 8 not started):

- [ ] **Step 1 (alt): Create minimal placeholder ConversationSidebar.svelte**

Create `src/lib/components/ConversationSidebar.svelte` with just the tab switcher and Intelligence panel. The conversations tab shows a placeholder message. This gets replaced when Task 8 of ui-revolution runs.

```svelte
<script>
  import IntelligencePanel from "./IntelligencePanel.svelte";

  let { personaId } = $props();
  let activeTab = $state("conversations");
</script>

<aside class="conv-sidebar">
  <div class="conv-sidebar-header">
    <div class="sidebar-tabs">
      <button
        class="sidebar-tab"
        class:active={activeTab === "conversations"}
        onclick={() => activeTab = "conversations"}
      >Conversations</button>
      <button
        class="sidebar-tab"
        class:active={activeTab === "intelligence"}
        onclick={() => activeTab = "intelligence"}
      >Intelligence</button>
    </div>
  </div>

  <div class="sidebar-content">
    {#if activeTab === "conversations"}
      <p style="padding: 1rem; color: var(--text-tertiary); font-size: 0.75rem;">
        Conversations list — to be implemented by ui-revolution Task 8
      </p>
    {:else}
      <IntelligencePanel {personaId} />
    {/if}
  </div>
</aside>

<style>
  .conv-sidebar {
    width: 280px;
    min-width: 280px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .conv-sidebar-header {
    border-bottom: 1px solid var(--border);
  }
  .sidebar-content {
    flex: 1;
    overflow-y: auto;
  }
  .sidebar-tabs {
    display: flex;
  }
  .sidebar-tab {
    flex: 1;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-tertiary);
    font-size: 0.6875rem;
    font-weight: 500;
    padding: 0.5rem 0;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
    font-family: inherit;
  }
  .sidebar-tab:hover { color: var(--text-secondary); }
  .sidebar-tab.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }

  @media (max-width: 768px) {
    .conv-sidebar { display: none; }
  }
</style>
```

- [ ] **Step 2 (alt): Commit placeholder**

```bash
git add src/lib/components/ConversationSidebar.svelte
git commit -m "feat: ConversationSidebar placeholder with Intelligence tab"
```

---

## Chunk 3: Integration + Verification

### Task 5: Wire sidebar into chat page + test

**Files:**
- Modify: `src/routes/chat/[persona]/+page.svelte`

- [ ] **Step 1: Import and mount sidebar**

If not already imported, add the sidebar to the chat page layout. The chat page should have a flex layout with the sidebar on the left:

```svelte
<script>
  import ConversationSidebar from "$lib/components/ConversationSidebar.svelte";
  // ... existing imports
</script>

<div class="chat-layout">
  <ConversationSidebar personaId={data.personaId} />
  <div class="chat-main">
    <!-- existing chat content -->
  </div>
</div>
```

If ConversationSidebar is already mounted, skip this step.

- [ ] **Step 2: Start dev server and test**

```bash
npm run dev
```

Open browser at `localhost:5173`. Login → select persona → chat page.

Verify:
1. Sidebar shows two tabs: "Conversations" and "Intelligence"
2. Click "Intelligence" → loading spinner → stats + corrections + entities appear
3. Corrections show date, truncated text, X button
4. Click correction → expands with context
5. Click X → "Supprimer ?" appears → click again → correction removed + toast
6. Wait 4s without clicking "Supprimer ?" → reverts to X
7. Entities grouped by type with confidence bars
8. Click entity → expands with description + relations
9. Switch back to "Conversations" tab → conversation list appears
10. On narrow window (< 768px) → sidebar hidden (desktop-only, as specified)

- [ ] **Step 3: Test error states**

1. Disconnect network → click Intelligence tab → "Erreur de chargement" + "Reessayer" button
2. Click "Reessayer" with network back → data loads

- [ ] **Step 4: Test with persona that has no corrections/entities**

Use a fresh persona. Verify:
- Stats show 0/0/0
- "Aucune correction" message appears
- "Aucune entite" message appears

- [ ] **Step 5: Commit spec update**

```bash
git add docs/superpowers/specs/2026-04-15-persona-intelligence-design.md
git commit -m "docs: update intelligence spec for Svelte 5 target"
```

---

## Summary

| Chunk | Tasks | What it delivers |
|-------|-------|-----------------|
| 1 | Tasks 1-2 | Backend: export loadPersonaData, GET + DELETE in feedback.js |
| 2 | Tasks 3-4 | Frontend: IntelligencePanel component + sidebar tab switcher |
| 3 | Task 5 | Integration into chat page + full verification |

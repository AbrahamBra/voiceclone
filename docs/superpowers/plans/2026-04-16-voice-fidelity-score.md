# Voice Fidelity Score — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a voice fidelity score that measures how well a clone reproduces the human's writing style, displayed on hub cards and in the intelligence panel.

**Architecture:** Cosine similarity between clone-generated text and original LinkedIn post embeddings, clustered by theme. Score stored with history for trend visualization. Batch API for hub, detailed API for intelligence panel.

**Tech Stack:** Voyage-3 embeddings, Claude Sonnet (generation) + Haiku (theme labeling), Supabase pgvector, SvelteKit scoped CSS.

**Spec:** `docs/superpowers/specs/2026-04-16-voice-fidelity-score-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| **new** `lib/fidelity.js` | cosineSim (shared), clustering, score pipeline |
| **new** `api/fidelity.js` | GET (single + batch) + POST endpoints |
| **new** `supabase/015_fidelity_scores.sql` | Table + index |
| **mod** `lib/correction-consolidation.js` | Import shared cosineSim, add recalc trigger |
| **mod** `src/lib/components/IntelligencePanel.svelte` | Fidelity section at top |
| **mod** `src/routes/+page.svelte` | Batch fetch + SVG gauge on clone cards |
| **mod** `src/routes/admin/+page.svelte` | Fidelity line in persona grid |
| **mod** `api/usage.js` | Lateral join for admin |

---

## Chunk 1: Core Scoring Engine

### Task 1: Database Migration

**Files:**
- Create: `supabase/015_fidelity_scores.sql`

- [ ] **Step 1: Write migration**

```sql
-- 015_fidelity_scores.sql
CREATE TABLE IF NOT EXISTS fidelity_scores (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  persona_id uuid REFERENCES personas(id) ON DELETE CASCADE NOT NULL,
  score_global integer NOT NULL,
  score_raw float NOT NULL,
  scores_by_theme jsonb NOT NULL,
  theme_count integer NOT NULL,
  chunk_count integer NOT NULL,
  low_confidence boolean DEFAULT false,
  calculated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fidelity_persona
  ON fidelity_scores(persona_id, calculated_at DESC);
```

- [ ] **Step 2: Apply migration**

Run: `npx supabase db push` or apply via Supabase dashboard SQL editor.
Expected: Table created, index created, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/015_fidelity_scores.sql
git commit -m "feat: add fidelity_scores table"
```

---

### Task 2: Shared cosineSim + Clustering (`lib/fidelity.js`)

**Files:**
- Create: `lib/fidelity.js`
- Modify: `lib/correction-consolidation.js` (import change only)

- [ ] **Step 1: Create `lib/fidelity.js` with cosineSim and clustering**

```js
/**
 * Voice fidelity scoring engine.
 *
 * Measures how well a clone reproduces the original human's writing style
 * by comparing clone-generated text against original LinkedIn post embeddings.
 */

import Anthropic from "@anthropic-ai/sdk";
import { supabase, getApiKey } from "./supabase.js";
import { embed, isEmbeddingAvailable } from "./embeddings.js";
import { buildSystemPrompt } from "./prompt.js";
import { loadPersonaData, getIntelligenceId } from "./knowledge-db.js";

const CLUSTER_THRESHOLD = 0.70;
const MIN_CHUNKS = 3;
const MIN_CLUSTER_SIZE = 2;
const RAW_MIN = 0.35;
const RAW_MAX = 0.90;

/**
 * Cosine similarity between two vectors.
 */
export function cosineSim(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Greedy clustering by cosine similarity.
 * Returns: [{ members: [idx], centroid: number[] }]
 */
export function clusterByTheme(embeddings, threshold = CLUSTER_THRESHOLD) {
  const clusters = [];

  for (let i = 0; i < embeddings.length; i++) {
    const emb = embeddings[i];
    let bestCluster = -1;
    let bestSim = 0;

    for (let c = 0; c < clusters.length; c++) {
      const sim = cosineSim(emb, clusters[c].centroid);
      if (sim > threshold && sim > bestSim) {
        bestCluster = c;
        bestSim = sim;
      }
    }

    if (bestCluster >= 0) {
      const cluster = clusters[bestCluster];
      cluster.members.push(i);
      const n = cluster.members.length;
      for (let d = 0; d < emb.length; d++) {
        cluster.centroid[d] = cluster.centroid[d] * ((n - 1) / n) + emb[d] / n;
      }
    } else {
      clusters.push({ members: [i], centroid: [...emb] });
    }
  }

  return clusters;
}

/**
 * Rescale raw cosine similarity to 0-100 display range.
 */
export function rescaleScore(raw) {
  return Math.round(Math.min(100, Math.max(0,
    ((raw - RAW_MIN) / (RAW_MAX - RAW_MIN)) * 100
  )));
}
```

- [ ] **Step 2: Update `lib/correction-consolidation.js` to import shared cosineSim**

Replace lines 22-33 (the local `cosineSim` function) with an import:

```js
// At top of file, add:
import { cosineSim } from "./fidelity.js";

// Delete the local cosineSim function (lines 25-33)
```

- [ ] **Step 3: Verify consolidation still works**

Run: `node -e "import('./lib/correction-consolidation.js').then(m => console.log('OK'))"`
Expected: "OK" (no import errors)

- [ ] **Step 4: Commit**

```bash
git add lib/fidelity.js lib/correction-consolidation.js
git commit -m "feat: shared cosineSim and clustering for fidelity scoring"
```

---

### Task 3: Full Score Calculation Pipeline

**Files:**
- Modify: `lib/fidelity.js` (add `calculateFidelityScore`)

- [ ] **Step 1: Add the score pipeline function to `lib/fidelity.js`**

Append after the `rescaleScore` function:

```js
/**
 * Find the member closest to centroid in a cluster.
 */
function closestToCentroid(cluster, embeddings) {
  let bestIdx = cluster.members[0];
  let bestSim = -1;
  for (const idx of cluster.members) {
    const sim = cosineSim(embeddings[idx], cluster.centroid);
    if (sim > bestSim) { bestSim = sim; bestIdx = idx; }
  }
  return bestIdx;
}

/**
 * Label theme clusters via Haiku.
 */
async function labelThemes(anthropic, clusters, chunks) {
  const groups = clusters.map((cl, i) => {
    const repIdx = closestToCentroid(cl, chunks.map(c => c.embedding));
    const excerpt = chunks[repIdx].content.slice(0, 120);
    return `Group ${i + 1}: ${excerpt}`;
  }).join("\n");

  try {
    const result = await Promise.race([
      anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system: "Tu etiquettes des groupes de posts LinkedIn. Pour chaque groupe, donne un label court (2-4 mots) dans la langue des posts. Reponds en JSON: [\"label1\", \"label2\", ...]",
        messages: [{ role: "user", content: groups }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
    ]);
    const text = result.content[0].text.trim();
    const match = text.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : clusters.map((_, i) => `Theme ${i + 1}`);
  } catch {
    return clusters.map((_, i) => `Theme ${i + 1}`);
  }
}

/**
 * Generate clone text for a theme using the full persona prompt.
 */
async function generateCloneText(anthropic, persona, personaData, themeLabel, contextExcerpt, apiKey) {
  const systemPrompt = buildSystemPrompt(personaData);

  try {
    const result = await Promise.race([
      anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 200,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: `Ecris un post LinkedIn court (3-4 phrases) sur le theme : ${themeLabel}.\nContexte du post original : ${contextExcerpt}`,
        }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
    ]);
    return result.content[0].text.trim();
  } catch {
    return null;
  }
}

/**
 * Calculate voice fidelity score for a persona.
 * @param {string} personaId
 * @param {object} [options]
 * @param {object} [options.client] - Client object for API key resolution
 * @returns {Promise<object|null>} Score result or null if cannot calculate
 */
export async function calculateFidelityScore(personaId, { client = null } = {}) {
  if (!isEmbeddingAvailable()) return null;

  // 1. Load reference chunks
  const { data: rawChunks, error: chunkErr } = await supabase
    .from("chunks")
    .select("id, content, embedding, metadata")
    .eq("persona_id", personaId)
    .eq("source_type", "linkedin_post");

  if (chunkErr || !rawChunks?.length || rawChunks.length < MIN_CHUNKS) return null;

  // Parse embeddings from PostgREST string format
  const chunks = [];
  for (const c of rawChunks) {
    try {
      chunks.push({ ...c, embedding: JSON.parse(c.embedding) });
    } catch {
      console.log(JSON.stringify({ event: "fidelity_parse_skip", chunk_id: c.id }));
    }
  }
  if (chunks.length < MIN_CHUNKS) return null;

  // 2. Cluster by theme
  const embeddings = chunks.map(c => c.embedding);
  const allClusters = clusterByTheme(embeddings);
  const clusters = allClusters.filter(c => c.members.length >= MIN_CLUSTER_SIZE);

  const lowConfidence = clusters.length < 2;
  const workClusters = clusters.length > 0 ? clusters : [allClusters.reduce((a, b) =>
    a.members.length >= b.members.length ? a : b
  )];

  // 3. Label themes
  const apiKey = getApiKey(client);
  const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  const labels = await labelThemes(anthropic, workClusters, chunks);

  // 4. Load persona data for prompt building
  const { data: persona } = await supabase
    .from("personas").select("*").eq("id", personaId).single();
  if (!persona) return null;

  const personaData = await loadPersonaData(persona);

  // 5. Score each theme
  const themeScores = [];
  for (let i = 0; i < workClusters.length; i++) {
    const cluster = workClusters[i];
    const repIdx = closestToCentroid(cluster, embeddings);
    const contextExcerpt = chunks[repIdx].content.slice(0, 200);

    // Generate clone text
    const generated = await generateCloneText(
      anthropic, persona, personaData, labels[i] || `Theme ${i + 1}`, contextExcerpt, apiKey
    );
    if (!generated) continue;

    // Embed with input_type="document" (symmetric comparison)
    const genEmbeddings = await embed([generated]);
    if (!genEmbeddings?.[0]) continue;

    const similarity = cosineSim(genEmbeddings[0], cluster.centroid);

    themeScores.push({
      theme: labels[i] || `Theme ${i + 1}`,
      score: rescaleScore(similarity),
      score_raw: similarity,
      chunk_count: cluster.members.length,
    });
  }

  if (themeScores.length === 0) return null;

  // 6. Weighted global score
  const totalWeight = themeScores.reduce((s, t) => s + t.chunk_count, 0);
  const rawGlobal = themeScores.reduce((s, t) => s + t.score_raw * t.chunk_count, 0) / totalWeight;

  const result = {
    score_global: rescaleScore(rawGlobal),
    score_raw: rawGlobal,
    scores_by_theme: themeScores.map(({ theme, score, chunk_count }) => ({ theme, score, chunk_count })),
    theme_count: themeScores.length,
    chunk_count: chunks.length,
    low_confidence: lowConfidence,
  };

  // 7. Persist
  const { error: insertErr } = await supabase.from("fidelity_scores").insert({
    persona_id: personaId,
    ...result,
    scores_by_theme: result.scores_by_theme,
  });

  if (insertErr) {
    console.log(JSON.stringify({ event: "fidelity_insert_error", error: insertErr.message }));
  }

  console.log(JSON.stringify({
    event: "fidelity_calculated",
    persona: personaId,
    score: result.score_global,
    themes: result.theme_count,
    chunks: result.chunk_count,
  }));

  return result;
}
```

- [ ] **Step 2: Verify module loads without errors**

Run: `node -e "import('./lib/fidelity.js').then(m => console.log('exports:', Object.keys(m)))"`
Expected: `exports: [ 'cosineSim', 'clusterByTheme', 'rescaleScore', 'calculateFidelityScore' ]`

- [ ] **Step 3: Commit**

```bash
git add lib/fidelity.js
git commit -m "feat: fidelity score calculation pipeline"
```

---

## Chunk 2: API Endpoints

### Task 4: Fidelity API (`api/fidelity.js`)

**Files:**
- Create: `api/fidelity.js`

- [ ] **Step 1: Create the API handler**

```js
import { authenticateRequest, supabase, setCors, hasPersonaAccess } from "../lib/supabase.js";
import { calculateFidelityScore } from "../lib/fidelity.js";

export default async function handler(req, res) {
  setCors(res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" }); return;
  }

  // ── GET: Fetch scores ──
  if (req.method === "GET") {
    // Batch mode: ?personas=id1,id2,id3
    const personasParam = req.query?.personas;
    if (personasParam) {
      const ids = personasParam.split(",").filter(Boolean);
      if (ids.length === 0) { res.status(400).json({ error: "No persona IDs" }); return; }
      if (ids.length > 20) { res.status(400).json({ error: "Max 20 personas" }); return; }

      // Auth: check access to all personas (skip for admin)
      if (!isAdmin) {
        for (const id of ids) {
          if (!(await hasPersonaAccess(client?.id, id))) {
            res.status(403).json({ error: "Forbidden" }); return;
          }
        }
      }

      // Fetch latest score per persona via distinct-on
      const { data, error } = await supabase.rpc("get_latest_fidelity_scores", { persona_ids: ids });

      // Fallback if RPC doesn't exist yet: manual query
      if (error) {
        const scores = {};
        for (const id of ids) {
          const { data: rows } = await supabase
            .from("fidelity_scores")
            .select("score_global, calculated_at")
            .eq("persona_id", id)
            .order("calculated_at", { ascending: false })
            .limit(1);
          scores[id] = rows?.[0] || null;
        }
        res.json({ scores });
        return;
      }

      const scores = {};
      for (const row of (data || [])) {
        scores[row.persona_id] = { score_global: row.score_global, calculated_at: row.calculated_at };
      }
      res.json({ scores });
      return;
    }

    // Single mode: ?persona=id
    const personaId = req.query?.persona;
    if (!personaId) { res.status(400).json({ error: "persona or personas param required" }); return; }

    if (!isAdmin) {
      if (!(await hasPersonaAccess(client?.id, personaId))) {
        res.status(403).json({ error: "Forbidden" }); return;
      }
    }

    // Latest score
    const { data: latest } = await supabase
      .from("fidelity_scores")
      .select("*")
      .eq("persona_id", personaId)
      .order("calculated_at", { ascending: false })
      .limit(1);

    // History (last 10)
    const { data: history } = await supabase
      .from("fidelity_scores")
      .select("score_global, calculated_at")
      .eq("persona_id", personaId)
      .order("calculated_at", { ascending: false })
      .limit(10);

    // Chunk count for can_calculate
    const { count } = await supabase
      .from("chunks")
      .select("id", { count: "exact", head: true })
      .eq("persona_id", personaId)
      .eq("source_type", "linkedin_post");

    res.json({
      current: latest?.[0] || null,
      history: (history || []).reverse(),
      chunk_count: count || 0,
      can_calculate: (count || 0) >= 3,
    });
    return;
  }

  // ── POST: Trigger recalculation ──
  if (req.method === "POST") {
    const { personaId } = req.body || {};
    if (!personaId) { res.status(400).json({ error: "personaId required" }); return; }

    if (!isAdmin) {
      if (!(await hasPersonaAccess(client?.id, personaId))) {
        res.status(403).json({ error: "Forbidden" }); return;
      }
    }

    // Rate limit: max 1 per hour
    const { data: recent } = await supabase
      .from("fidelity_scores")
      .select("calculated_at")
      .eq("persona_id", personaId)
      .order("calculated_at", { ascending: false })
      .limit(1);

    if (recent?.[0]) {
      const elapsed = Date.now() - new Date(recent[0].calculated_at).getTime();
      if (elapsed < 3600_000) {
        res.status(429).json({
          error: "Rate limited",
          retry_after_seconds: Math.ceil((3600_000 - elapsed) / 1000),
        });
        return;
      }
    }

    const result = await calculateFidelityScore(personaId, { client });
    if (!result) {
      res.json({ error: "Cannot calculate", can_calculate: false });
      return;
    }

    res.json(result);
  }
}
```

- [ ] **Step 2: Verify the endpoint loads**

Run: `node -e "import('./api/fidelity.js').then(m => console.log('handler:', typeof m.default))"`
Expected: `handler: function`

- [ ] **Step 3: Commit**

```bash
git add api/fidelity.js
git commit -m "feat: fidelity API with GET (single + batch) and POST"
```

---

### Task 5: Wire Consolidation Trigger

**Files:**
- Modify: `lib/correction-consolidation.js`

- [ ] **Step 1: Add fidelity recalc at end of consolidateCorrections**

At the top of the file, add the import (below existing imports):

```js
import { calculateFidelityScore } from "./fidelity.js";
```

At the end of the `consolidateCorrections` function, just before the final `return` statement (after the `console.log` on line 172), add:

```js
  // Fire-and-forget fidelity recalc — must never break consolidation
  try {
    calculateFidelityScore(personaId, { client }).catch(() => {});
  } catch { /* ignore */ }
```

- [ ] **Step 2: Verify module still loads**

Run: `node -e "import('./lib/correction-consolidation.js').then(m => console.log('OK'))"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add lib/correction-consolidation.js
git commit -m "feat: trigger fidelity recalc after correction consolidation"
```

---

## Chunk 3: Hub UI — Score Gauge

### Task 6: SVG Gauge on Hub Clone Cards

**Files:**
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Add fidelity data fetching**

In the `<script>` block of `+page.svelte`, after the existing `personaConfigs` state, add:

```js
let fidelityScores = $state({});

async function loadFidelityScores(configs) {
  const ids = configs.map(e => e.persona.id).filter(Boolean);
  if (ids.length === 0) return;
  try {
    const data = await api(`/api/fidelity?personas=${ids.join(",")}`);
    fidelityScores = data.scores || {};
  } catch {
    // Non-blocking — hub works fine without scores
  }
}
```

Then in the existing function that loads persona configs (look for where `personaConfigs` is assigned), add a call after loading completes:

```js
// After personaConfigs is populated:
loadFidelityScores(personaConfigs);
```

- [ ] **Step 2: Add SVG gauge component inline**

Add this snippet block in the `<script>` section:

```js
function gaugeArc(score) {
  // SVG arc for semicircle gauge, 0-100 mapped to arc
  const r = 14;
  const circumference = Math.PI * r;
  const offset = circumference * (1 - score / 100);
  return { r, circumference, offset };
}
```

- [ ] **Step 3: Add gauge to clone card markup**

In both the "Mes clones" and "Clones partages" sections, inside each `.clone-header` button, after the `.clone-info` div, add:

```svelte
{@const fScore = fidelityScores[entry.persona.id]}
{#if fScore}
  {@const g = gaugeArc(fScore.score_global)}
  <div class="fidelity-gauge" title="Fidelite vocale: {fScore.score_global}%">
    <svg viewBox="0 0 36 20" width="36" height="20">
      <path d="M 4 18 A 14 14 0 0 1 32 18" fill="none"
        stroke="var(--border)" stroke-width="2.5" stroke-linecap="round" />
      <path d="M 4 18 A 14 14 0 0 1 32 18" fill="none"
        stroke={fScore.score_global >= 75 ? 'var(--success)' : fScore.score_global >= 50 ? 'var(--warning)' : 'var(--error)'}
        stroke-width="2.5" stroke-linecap="round"
        stroke-dasharray="{g.circumference}" stroke-dashoffset="{g.offset}" />
    </svg>
    <span class="fidelity-score">{fScore.score_global}</span>
  </div>
{/if}
```

- [ ] **Step 4: Add styles**

In the `<style>` block, add:

```css
.fidelity-gauge {
  position: relative;
  flex-shrink: 0;
  margin-left: auto;
  width: 36px;
  height: 24px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.fidelity-gauge svg {
  position: absolute;
  top: 0;
  left: 0;
}
.fidelity-score {
  font-size: 0.625rem;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  position: relative;
  line-height: 1;
}
```

- [ ] **Step 5: Test in browser**

Run dev server, navigate to hub page. Verify:
- Clone cards show gauge if fidelity data exists
- No gauge shown for personas without scores (no errors)
- Gauge color reflects score range

- [ ] **Step 6: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "feat: fidelity gauge on hub clone cards"
```

---

## Chunk 4: Intelligence Panel — Fidelity Section

### Task 7: Fidelity Section in IntelligencePanel

**Files:**
- Modify: `src/lib/components/IntelligencePanel.svelte`

- [ ] **Step 1: Add fidelity data fetching**

In the `<script>` block, add after the existing state declarations (around line 13):

```js
let fidelity = $state(null);
let fidelityLoading = $state(true);
let recalculating = $state(false);
```

Add a fidelity loader function:

```js
async function loadFidelity() {
  fidelityLoading = true;
  try {
    fidelity = await api(`/api/fidelity?persona=${personaId}`);
  } catch {
    fidelity = null;
  } finally {
    fidelityLoading = false;
  }
}

async function recalcFidelity() {
  recalculating = true;
  try {
    await api("/api/fidelity", {
      method: "POST",
      body: JSON.stringify({ personaId }),
    });
    await loadFidelity();
    showToast("Score recalcule");
  } catch (e) {
    if (e.status === 429) showToast("Recalcul limite a 1x/heure");
    else showToast("Erreur de recalcul");
  } finally {
    recalculating = false;
  }
}
```

In the existing `$effect` that watches `personaId` (line 23), add `loadFidelity()` alongside `loadData()`:

```js
$effect(() => {
  if (personaId) { loadData(); loadFidelity(); }
});
```

Add a derived for the previous score delta:

```js
let scoreDelta = $derived.by(() => {
  if (!fidelity?.history || fidelity.history.length < 2) return null;
  const current = fidelity.history[fidelity.history.length - 1]?.score_global;
  const previous = fidelity.history[fidelity.history.length - 2]?.score_global;
  if (current == null || previous == null) return null;
  return current - previous;
});
```

- [ ] **Step 2: Add fidelity section markup**

Insert this block between the extraction bar (`{/if}` on line 151) and the loading check (`{#if loading}` on line 153). This goes right after the extraction bar, before everything else:

```svelte
<!-- Fidelity Score -->
{#if !fidelityLoading && fidelity?.current}
  {@const cur = fidelity.current}
  <div class="fidelity-section">
    <div class="fidelity-header">
      <span class="fidelity-title">FIDELITE VOCALE</span>
      <div class="fidelity-headline">
        <span class="fidelity-big-score">{cur.score_global}</span>
        {#if scoreDelta != null}
          <span class="fidelity-delta" class:positive={scoreDelta > 2} class:negative={scoreDelta < -2}>
            {scoreDelta > 0 ? "+" : ""}{scoreDelta} pts
          </span>
        {/if}
      </div>
    </div>

    <div class="fidelity-bar-track">
      <div class="fidelity-bar-fill" style="width: {cur.score_global}%"></div>
    </div>

    {#if cur.scores_by_theme?.length > 0}
      <div class="fidelity-themes">
        {#each cur.scores_by_theme as t}
          <div class="fidelity-theme">
            <span class="fidelity-theme-name">{t.theme}</span>
            <div class="fidelity-theme-bar">
              <div class="fidelity-theme-fill" style="width: {t.score}%"></div>
            </div>
            <span class="fidelity-theme-score">{t.score}</span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="fidelity-meta">
      <span>{fidelity.chunk_count} posts</span>
      <span>·</span>
      <span>{getRelativeTime(cur.calculated_at)}</span>
      <button class="fidelity-recalc" onclick={recalcFidelity} disabled={recalculating}>
        {recalculating ? "..." : "Recalculer"}
      </button>
    </div>

    {#if fidelity.history.length > 2}
      <div class="fidelity-sparkline">
        <svg viewBox="0 0 200 40" preserveAspectRatio="none">
          {@const pts = fidelity.history}
          {@const maxS = Math.max(...pts.map(p => p.score_global), 1)}
          {@const minS = Math.min(...pts.map(p => p.score_global), 0)}
          {@const range = Math.max(maxS - minS, 1)}
          <polyline
            fill="none"
            stroke="var(--accent)"
            stroke-width="1.5"
            points={pts.map((p, i) =>
              `${(i / (pts.length - 1)) * 200},${40 - ((p.score_global - minS) / range) * 36}`
            ).join(" ")}
          />
          {#each pts as p, i}
            <circle
              cx="{(i / (pts.length - 1)) * 200}"
              cy="{40 - ((p.score_global - minS) / range) * 36}"
              r="2" fill="var(--accent)"
            />
          {/each}
        </svg>
      </div>
    {/if}

    {#if cur.low_confidence}
      <div class="fidelity-warning">Score base sur peu de donnees — precision limitee</div>
    {/if}
  </div>
{:else if !fidelityLoading && fidelity && !fidelity.can_calculate}
  <div class="fidelity-section fidelity-empty">
    <span class="fidelity-title">FIDELITE VOCALE</span>
    <p>Pas assez de posts LinkedIn pour calculer le score (minimum 3).</p>
  </div>
{/if}
```

- [ ] **Step 3: Add fidelity styles**

Add to the `<style>` block:

```css
.fidelity-section {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border);
}
.fidelity-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}
.fidelity-title {
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.fidelity-headline {
  display: flex;
  align-items: baseline;
  gap: 0.375rem;
}
.fidelity-big-score {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.fidelity-delta {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.fidelity-delta.positive { color: var(--success); }
.fidelity-delta.negative { color: var(--error); }
.fidelity-bar-track {
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 0.625rem;
}
.fidelity-bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.6s ease;
}
.fidelity-themes {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
}
.fidelity-theme {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}
.fidelity-theme-name {
  font-size: 0.6875rem;
  color: var(--text-secondary);
  min-width: 8rem;
  flex-shrink: 0;
}
.fidelity-theme-bar {
  flex: 1;
  height: 3px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
}
.fidelity-theme-fill {
  height: 100%;
  background: var(--accent);
  opacity: 0.7;
  border-radius: 2px;
  transition: width 0.4s;
}
.fidelity-theme-score {
  font-size: 0.625rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  min-width: 1.5rem;
  text-align: right;
}
.fidelity-meta {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.625rem;
  color: var(--text-tertiary);
}
.fidelity-recalc {
  margin-left: auto;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-secondary);
  padding: 0.125rem 0.375rem;
  font-size: 0.5625rem;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.fidelity-recalc:hover:not(:disabled) { color: var(--text); border-color: var(--text-tertiary); }
.fidelity-recalc:disabled { opacity: 0.4; cursor: default; }
.fidelity-sparkline {
  margin-top: 0.5rem;
  height: 40px;
}
.fidelity-sparkline svg {
  width: 100%;
  height: 100%;
}
.fidelity-warning {
  font-size: 0.5625rem;
  color: var(--warning);
  margin-top: 0.375rem;
}
.fidelity-empty p {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin: 0.375rem 0 0;
}
```

- [ ] **Step 4: Test in browser**

Navigate to a clone chat, open the intelligence panel. Verify:
- Fidelity section appears at top (or "not enough posts" message)
- Score, theme breakdown, sparkline render correctly
- "Recalculer" button works and disables during recalc
- No layout shifts or broken styles

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/IntelligencePanel.svelte
git commit -m "feat: fidelity score section in intelligence panel"
```

---

## Chunk 5: Admin Dashboard + Final Wiring

### Task 8: Admin Fidelity Display

**Files:**
- Modify: `src/routes/admin/+page.svelte`
- Modify: `api/usage.js`

- [ ] **Step 1: Add fidelity to the admin personas query**

In `api/usage.js`, find where personas are queried for `view=personas`. Add a subquery for latest fidelity score. This is a lateral join pattern — find the query that selects persona data and add:

After fetching personas, add a batch fidelity lookup:

```js
// After personas are loaded, fetch latest fidelity scores
const personaIds = personas.map(p => p.id);
const { data: fScores } = await supabase
  .from("fidelity_scores")
  .select("persona_id, score_global, calculated_at")
  .in("persona_id", personaIds)
  .order("calculated_at", { ascending: false });

// Keep only latest per persona
const fidelityMap = {};
for (const s of (fScores || [])) {
  if (!fidelityMap[s.persona_id]) fidelityMap[s.persona_id] = s;
}

// Attach to persona objects
for (const p of personas) {
  p.fidelity = fidelityMap[p.id] || null;
}
```

- [ ] **Step 2: Show fidelity in admin persona grid**

In `admin/+page.svelte`, find the persona cards in the grid. After the existing stats line (conversations, corrections, entities), add:

```svelte
{#if p.fidelity}
  <div class="admin-fidelity">
    Fidelite: {p.fidelity.score_global}
  </div>
{/if}
```

Add style:

```css
.admin-fidelity {
  font-size: 0.6875rem;
  color: var(--text-secondary);
  margin-top: 0.25rem;
}
```

- [ ] **Step 3: Test in browser**

Navigate to admin page. Verify fidelity shows on persona cards that have scores.

- [ ] **Step 4: Commit**

```bash
git add api/usage.js src/routes/admin/+page.svelte
git commit -m "feat: fidelity score in admin persona grid"
```

---

### Task 9: End-to-End Verification

- [ ] **Step 1: Trigger a manual calculation**

Via browser dev console or curl:
```bash
curl -X POST http://localhost:3000/api/fidelity \
  -H "Content-Type: application/json" \
  -H "x-access-code: YOUR_CODE" \
  -d '{"personaId": "YOUR_PERSONA_ID"}'
```

Expected: JSON response with `score_global`, `scores_by_theme`, etc.

- [ ] **Step 2: Verify hub shows the gauge**

Reload the hub page. The clone card should now show the arc gauge with the score.

- [ ] **Step 3: Verify intelligence panel shows full detail**

Open a clone chat, open intelligence panel. Fidelity section should show score, themes, sparkline.

- [ ] **Step 4: Verify admin shows the score**

Navigate to admin page. Persona cards should show fidelity line.

- [ ] **Step 5: Verify rate limiting**

Try triggering recalculation again immediately via POST.
Expected: 429 response with `retry_after_seconds`.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: voice fidelity score — complete feature"
```

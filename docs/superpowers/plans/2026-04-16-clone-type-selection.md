# Clone Type Selection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a type selection step at clone creation so the wizard adapts dynamically — posts-only, DM-only, or both — removing irrelevant steps and adjusting validation accordingly.

**Architecture:** A new `cloneType` state variable drives a derived `steps` array (strings). All navigation uses index lookup into this array. The API receives `cloneType`, applies conditional validation and conditional analysis calls, and stores the value in a new `personas.type` column.

**Tech Stack:** Svelte 5 (runes: `$state`, `$derived`), SvelteKit, Node.js API handler, Supabase/Postgres

**Spec:** `docs/superpowers/specs/2026-04-16-clone-type-selection-design.md`

---

## Chunk 1: Database + API

### Task 1: DB migration — add `type` column to `personas`

**Files:**
- Create: `supabase/007_clone_type.sql`

No test framework is present in this project. Verification is done by running the app and checking the DB state.

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/007_clone_type.sql
ALTER TABLE personas
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'both'
  CHECK (type IN ('posts', 'dm', 'both'));
```

- [ ] **Step 2: Apply the migration to your local Supabase**

```bash
supabase db push
# or run it directly in the Supabase SQL editor
```

Expected: No error. Column `type` now exists on `personas` with default `'both'`.

- [ ] **Step 3: Verify**

In Supabase SQL editor or CLI:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'personas' AND column_name = 'type';
```
Expected: row with `column_default = 'both'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/007_clone_type.sql
git commit -m "feat: add type column to personas table"
```

---

### Task 2: API — accept `cloneType`, conditional validation and analysis

**Files:**
- Modify: `api/clone.js:121-131` (destructure + validation), `api/clone.js:138-177` (analysis promises), `api/clone.js:200-214` (insert), `api/clone.js:259-266` (scenario files)

- [ ] **Step 1: Destructure `cloneType` from request body (line ~121)**

Change:
```js
const { linkedin_text, posts, dms, documents, name } = req.body || {};
```
To:
```js
const { linkedin_text, posts, dms, documents, name, cloneType } = req.body || {};
```

- [ ] **Step 2: Make posts validation conditional (line ~127)**

Change:
```js
if (!posts || !Array.isArray(posts) || posts.length < 3) {
  res.status(400).json({ error: "posts required (array, min 3 posts)" });
  return;
}
```
To:
```js
if (cloneType !== 'dm' && (!posts || !Array.isArray(posts) || posts.length < 3)) {
  res.status(400).json({ error: "posts required (array, min 3 posts)" });
  return;
}
```

- [ ] **Step 3: Refactor analysis promises to be conditional (lines ~138-177)**

Replace the current `analysisPromises` array construction with named conditional promises so positions are stable.

Note: for DM-only clones, DMs are passed to the persona config prompt (`CLONE_SYSTEM_PROMPT`) so it can analyse the person's communication style from their DM conversations. This is intentional — without posts, DMs are the best signal available.

```js
const userContent = [
  "PROFIL LINKEDIN :",
  linkedin_text,
];

const postsContentForStyle = posts?.length > 0
  ? posts.slice(0, 30).map((p, i) => `--- POST ${i + 1} ---\n${p}`).join("\n\n")
  : null;

if (postsContentForStyle) {
  userContent.push("", "POSTS LINKEDIN (" + posts.length + " posts) :", postsContentForStyle);
}

const dmsContent = dms?.length > 0
  ? dms.map((d, i) => `--- CONVERSATION ${i + 1} ---\n${d}`).join("\n\n")
  : null;

if (dmsContent) {
  userContent.push("", "DMs LINKEDIN :", dmsContent);
}
if (documents) {
  userContent.push("", "DOCUMENTATION CLIENT :", documents);
}

const configPromise = anthropic.messages.create({
  model: MODEL, max_tokens: 2048,
  system: CLONE_SYSTEM_PROMPT,
  messages: [{ role: "user", content: userContent.join("\n") }],
});

const stylePromise = cloneType !== 'dm' && postsContentForStyle
  ? anthropic.messages.create({
      model: MODEL, max_tokens: 2048,
      system: STYLE_ANALYSIS_PROMPT,
      messages: [{ role: "user", content: postsContentForStyle }],
    })
  : Promise.resolve(null);

const dmPromise = dmsContent
  ? anthropic.messages.create({
      model: MODEL, max_tokens: 2048,
      system: DM_ANALYSIS_PROMPT,
      messages: [{ role: "user", content: dmsContent }],
    })
  : Promise.resolve(null);

const [configResult, styleResult, dmResult] = await Promise.all([configPromise, stylePromise, dmPromise]);
```

Also remove the old duplicate variable declarations at lines ~149–153. Change:
```js
const postsContent = posts.slice(0, 30).map((p, i) => `--- POST ${i + 1} ---\n${p}`).join("\n\n");

const dmsContent = dms?.length > 0
  ? dms.map((d, i) => `--- CONVERSATION ${i + 1} ---\n${d}`).join("\n\n")
  : null;
```
To: _(delete these lines entirely — both variables are now declared inside the replacement block above)_

Failure to remove them will cause a `SyntaxError: Identifier 'dmsContent' has already been declared`.

- [ ] **Step 4: Save `type` in the personas insert (line ~200)**

Add `type: cloneType || 'both'` to the insert object:
```js
const { data: persona, error: insertErr } = await supabase
  .from("personas")
  .insert({
    slug,
    client_id: client?.id || null,
    name: personaConfig.name,
    title: personaConfig.title || "",
    avatar: personaConfig.avatar || personaConfig.name.slice(0, 2).toUpperCase(),
    description: personaConfig.description || "",
    voice: personaConfig.voice,
    scenarios: personaConfig.scenarios,
    theme: personaConfig.theme || { accent: "#2563eb", background: "#0a0a0a", surface: "#141414", text: "#e5e5e5" },
    type: cloneType || 'both',
  })
  .select()
  .single();
```

- [ ] **Step 5: Make style knowledge file insertion conditional (lines ~186-225)**

Replace the entire block from `const configRaw = ...` through the style `knowledge_files` insert with the version below. **This step and Step 8 must be applied together** — `styleBody` is declared here at outer scope so the fire-and-forget embedding block can reference it.

```js
const configRaw = configResult.content[0].text.trim();
const jsonMatch = configRaw.match(/\{[\s\S]*\}/);
if (!jsonMatch) throw new Error("Failed to parse persona config JSON");
const personaConfig = JSON.parse(jsonMatch[0]);

if (name) personaConfig.name = name;

// styleBody declared here so the post-response fire-and-forget can reference it
let styleBody = null;

if (styleResult) {
  const styleContent = styleResult.content[0].text.trim();
  const fmMatch = styleContent.match(/^---\n([\s\S]*?)\n---/);
  let keywords = ["post", "poster", "ecrire", "rediger", "contenu", "linkedin"];
  if (fmMatch) {
    const kwMatch = fmMatch[1].match(/keywords:\s*\[(.*?)\]/);
    if (kwMatch) {
      keywords = kwMatch[1].split(",").map(k => k.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
  }
  styleBody = fmMatch ? styleContent.slice(fmMatch[0].length).trim() : styleContent;

  await supabase.from("knowledge_files").insert({
    persona_id: persona.id,
    path: "topics/style-posts-linkedin.md",
    keywords,
    content: styleBody,
    source_type: "auto",
  });
}
```

- [ ] **Step 6: Skip "post" scenario_file for DM-only clones (line ~263)**

Change:
```js
await supabase.from("scenario_files").insert([
  { persona_id: persona.id, slug: "default", content: defaultScenario },
  { persona_id: persona.id, slug: "post", content: postScenario },
]);
```
To:
```js
const scenarioRows = [
  { persona_id: persona.id, slug: "default", content: defaultScenario },
];
if (cloneType !== 'dm') {
  scenarioRows.push({ persona_id: persona.id, slug: "post", content: postScenario });
}
await supabase.from("scenario_files").insert(scenarioRows);
```

- [ ] **Step 7: Fix usage logging to handle null `styleResult` (line ~269)**

Change:
```js
const finalInput = (configResult.usage?.input_tokens || 0) + (styleResult.usage?.input_tokens || 0) + (dmResult?.usage?.input_tokens || 0);
const finalOutput = (configResult.usage?.output_tokens || 0) + (styleResult.usage?.output_tokens || 0) + (dmResult?.usage?.output_tokens || 0);
```
To:
```js
const finalInput = (configResult.usage?.input_tokens || 0) + (styleResult?.usage?.input_tokens || 0) + (dmResult?.usage?.input_tokens || 0);
const finalOutput = (configResult.usage?.output_tokens || 0) + (styleResult?.usage?.output_tokens || 0) + (dmResult?.usage?.output_tokens || 0);
```

- [ ] **Step 8: Fix fire-and-forget embedding to guard for DM-only clones (line ~325)**

In the fire-and-forget block, replace:
```js
const styleChunks = chunkText(styleBody);
await embedAndStore(supabase, styleChunks, persona.id, "knowledge_file", "topics/style-posts-linkedin.md");
if (documents && documents.length > 50) {
  const docChunks = chunkText(documents);
  await embedAndStore(supabase, docChunks, persona.id, "document", "documents/client-docs.md");
}
const postsText = posts.join("\n\n---\n\n");
const postChunks = chunkText(postsText);
await embedAndStore(supabase, postChunks, persona.id, "linkedin_post");
```
With:
```js
if (styleBody) {
  const styleChunks = chunkText(styleBody);
  await embedAndStore(supabase, styleChunks, persona.id, "knowledge_file", "topics/style-posts-linkedin.md");
}
if (documents && documents.length > 50) {
  const docChunks = chunkText(documents);
  await embedAndStore(supabase, docChunks, persona.id, "document", "documents/client-docs.md");
}
if (posts?.length > 0) {
  const postsTextForEmbed = posts.join("\n\n---\n\n");
  const postChunks = chunkText(postsTextForEmbed);
  await embedAndStore(supabase, postChunks, persona.id, "linkedin_post");
}
```

Note: `styleBody` is the outer-scope variable declared as `let styleBody = null` in Step 5 — it will be `null` for DM-only clones and truthy otherwise.

- [ ] **Step 9: Commit**

```bash
git add api/clone.js
git commit -m "feat: api accepts cloneType, conditional posts validation and analysis"
```

---

## Chunk 2: Frontend

### Task 3: Refactor navigation — string-based steps, dynamic TOTAL

**Files:**
- Modify: `src/routes/create/+page.svelte:1-187` (script section)

- [ ] **Step 1: Add `cloneType` state and derived `steps` + `TOTAL`**

Replace the top of the script (lines 7-9):
```js
let step = $state(1);
let direction = $state(1);
const TOTAL = 4;
```
With:
```js
let cloneType = $state(null); // 'posts' | 'dm' | 'both'
let step = $state('type');
let direction = $state(1);

const steps = $derived([
  'type',
  'info',
  ...(cloneType !== 'dm'    ? ['posts'] : []),
  ...(cloneType !== 'posts' ? ['dm']    : []),
  'docs',
]);
const TOTAL = $derived(steps.length);
```

- [ ] **Step 2: Add `setCloneType` function and replace `goToStep`**

Delete the `goToStep` function at line ~180 entirely and replace it with the three functions below:
```js
function goToStep(n) {
  direction = n > step ? 1 : -1;
  step = n;
}
```
With:
```js
function setCloneType(value) {
  cloneType = value;
  if (value === 'dm')    postsText = '';
  if (value === 'posts') dmsText = '';
}

function nextStep() {
  const idx = steps.indexOf(step);
  if (idx < steps.length - 1) {
    direction = 1;
    step = steps[idx + 1];
  }
}

function prevStep() {
  const idx = steps.indexOf(step);
  if (idx > 0) {
    direction = -1;
    step = steps[idx - 1];
  }
}
```

- [ ] **Step 3: Verify `$derived` expressions for `postsCount` and `dmsCount` (line ~185)**

These use a label-based syntax (`$derived: postsCount = ...`). A build check on Svelte 5.55.4 confirms this compiles without errors — keep them as-is.

- [ ] **Step 4: Update step counter and progress bar in template (line ~192)**

Change:
```svelte
<p class="create-subtitle">Étape {step}/{TOTAL}</p>
<div class="step-bar">
  {#each Array(TOTAL) as _, i}
    <div class="step-bar-item" class:active={i + 1 <= step}></div>
  {/each}
</div>
```
To:
```svelte
<p class="create-subtitle">
  {#if step !== 'type'}Étape {steps.indexOf(step)}/{TOTAL - 1}{/if}
</p>
<div class="step-bar">
  {#each steps.slice(1) as s, i}
    <div class="step-bar-item" class:active={steps.indexOf(step) > i}></div>
  {/each}
</div>
```

Note: we exclude the 'type' step from the progress bar (it's a pre-wizard selection). The bar shows steps 2–N (info through docs). The counter shows `Étape X/Y` only after the type is selected.

- [ ] **Step 5: Commit**

```bash
git add src/routes/create/+page.svelte
git commit -m "feat: string-based step navigation with dynamic steps array"
```

---

### Task 4: Step 0 — type selection UI

**Files:**
- Modify: `src/routes/create/+page.svelte` (template + styles)

- [ ] **Step 1: Add step 'type' block to template**

The current template uses `{#if step === 1}` etc. The `{#key step}` wrapper is at line 199. Inside it, add a new first branch before the existing `{#if step === 1}`:

Replace:
```svelte
{#if step === 1}
```
With:
```svelte
{#if step === 'type'}
  <div class="create-step">
    <div class="step-header">
      <strong>Pourquoi créer ce clone ?</strong>
      <span>Le flow de création s'adapte selon ton choix.</span>
    </div>

    <div class="type-cards">
      <button
        class="type-card"
        class:type-card-selected={cloneType === 'posts'}
        onclick={() => setCloneType('posts')}
      >
        <span class="type-card-icon">✍️</span>
        <strong>Posts LinkedIn</strong>
        <span>Génère du contenu écrit, hooks, carrousels</span>
      </button>
      <button
        class="type-card"
        class:type-card-selected={cloneType === 'dm'}
        onclick={() => setCloneType('dm')}
      >
        <span class="type-card-icon">💬</span>
        <strong>DMs LinkedIn</strong>
        <span>Répond en prospection et qualification</span>
      </button>
      <button
        class="type-card"
        class:type-card-selected={cloneType === 'both'}
        onclick={() => setCloneType('both')}
      >
        <span class="type-card-icon">⚡</span>
        <strong>Les deux</strong>
        <span>Flow complet, 5 étapes</span>
      </button>
    </div>

    <div class="create-actions">
      <button onclick={nextStep} disabled={!cloneType}>
        Continuer →
      </button>
    </div>
  </div>

{:else if step === 'info'}
```

- [ ] **Step 2: Update remaining step conditions in template**

Change all other `{:else if step === N}` to use step names:

- `{:else if step === 2}` → `{:else if step === 'posts'}`
- `{:else if step === 3}` → `{:else if step === 'dm'}`
- `{:else if step === 4}` → `{:else if step === 'docs'}`

- [ ] **Step 3: Replace all `goToStep(n)` calls with `nextStep()`/`prevStep()`**

In the `info` step (was step 1):
- `onclick={() => goToStep(2)}` → `onclick={nextStep}`

In the `posts` step (was step 2):
- `onclick={() => goToStep(1)}` → `onclick={prevStep}`
- `onclick={() => goToStep(3)}` → `onclick={nextStep}`

In the `dm` step (was step 3):
- `onclick={() => goToStep(2)}` → `onclick={prevStep}`
- `onclick={() => goToStep(4)}` (Passer button) → remove this button entirely (the DM step is only shown when `cloneType !== 'posts'`, and it's mandatory for `cloneType === 'dm'`, optional only for `cloneType === 'both'`)

Actually for `cloneType === 'both'`, keep a "Passer" button:
```svelte
<div class="create-actions">
  <button class="btn-secondary" onclick={prevStep}>← Retour</button>
  {#if cloneType === 'both'}
    <button class="btn-secondary" onclick={nextStep}>Passer</button>
  {/if}
  <button onclick={nextStep} disabled={cloneType === 'dm' && !dmsText.trim()}>Suivant →</button>
</div>
```

In the `docs` step (was step 4):
- `onclick={() => goToStep(3)}` → `onclick={prevStep}`

- [ ] **Step 4: Add type card styles to `<style>` section**

```css
.type-cards {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.type-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  text-align: left;
  font-family: var(--font);
  color: var(--text);
  transition: border-color 0.15s;
  width: 100%;
}

.type-card:hover {
  border-color: var(--text-tertiary);
}

.type-card-selected {
  border-color: var(--text-secondary);
  background: var(--surface);
}

.type-card-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.type-card strong {
  display: block;
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.type-card span:last-child {
  display: block;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-top: 0.125rem;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/create/+page.svelte
git commit -m "feat: add type selection step 0 with 3 cards"
```

---

### Task 5: Conditional recap + send `cloneType` to API

**Files:**
- Modify: `src/routes/create/+page.svelte` (recap block + createClone function)

- [ ] **Step 1: Make recap rows conditional**

In the `docs` step, change the recap block:
```svelte
<div class="generate-recap">
  <div class="recap-item">
    <span class="recap-label">Infos</span>
    <span>{personaName || "—"}{personaTitle ? ` · ${personaTitle}` : ""}</span>
  </div>
  {#if cloneType !== 'dm'}
    <div class="recap-item">
      <span class="recap-label">Posts</span>
      <span>{postsText.trim().split(/\n---\n/).filter(p => p.trim().length > 30).length} posts</span>
    </div>
  {/if}
  {#if cloneType !== 'posts'}
    <div class="recap-item">
      <span class="recap-label">DMs</span>
      <span>{dmsText.trim() ? `${dmsText.trim().split(/\n---\n/).filter(d => d.trim().length > 20).length} conversations` : "non renseigné"}</span>
    </div>
  {/if}
  {#if docsText.trim()}
    <div class="recap-item">
      <span class="recap-label">Docs</span>
      <span>{(docsText.trim().length / 1000).toFixed(1)}k chars</span>
    </div>
  {/if}
</div>
```

- [ ] **Step 2: Update `createClone` to send `cloneType` and adapt posts validation**

In the `createClone` function (line ~134), change the posts validation:
```js
const posts = postsText.trim().split(/\n---\n/).map(p => p.trim()).filter(p => p.length > 30);
if (cloneType !== 'dm' && posts.length < 3) {
  showToast("Minimum 3 posts (séparés par ---)");
  return;
}
```

And add `cloneType` to the API call body:
```js
body: JSON.stringify({
  linkedin_text: linkedin,
  posts: cloneType !== 'dm' ? posts : undefined,
  dms: dms.length > 0 ? dms : undefined,
  documents: docsText.trim() || undefined,
  name: personaName.trim() || undefined,
  cloneType,
}),
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/create/+page.svelte
git commit -m "feat: conditional recap rows + send cloneType to api"
```

---

### Task 6: Smoke test the full flow

No automated test framework exists. Verify manually by running the dev server.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test posts-only flow**
  1. Go to `/create`
  2. Select "Posts LinkedIn" card → click Continuer
  3. Progress bar shows 3 segments (info, posts, docs)
  4. Fill info, click Suivant → goes to posts step
  5. Fill 3+ posts, click Suivant → goes to docs step (no DM step)
  6. Recap shows Posts row, no DMs row
  7. Click "Générer le clone" → should succeed, persona created with `type = 'posts'`

- [ ] **Step 3: Test DM-only flow**
  1. Go to `/create`
  2. Select "DMs LinkedIn" card → click Continuer
  3. Progress bar shows 3 segments (info, dm, docs)
  4. Fill info → goes to DM step (no posts step)
  5. "Suivant →" button is disabled until DMs are filled
  6. Fill DMs, click Suivant → goes to docs
  7. Recap shows DMs row, no Posts row
  8. Generate → should succeed, persona created with `type = 'dm'`

- [ ] **Step 4: Test "both" flow**
  1. Go to `/create`
  2. Select "Les deux" card → Continuer
  3. Progress bar shows 4 segments (info, posts, dm, docs)
  4. DM step has "Passer" button available
  5. All fields visible, full 5-step flow works end-to-end

- [ ] **Step 5: Test back-navigation type change**
  1. Select "Posts", fill in posts on step 2
  2. Click back twice to reach step 0
  3. Select "DMs" → postsText should be cleared
  4. Continue to DM step — posts step is absent

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "feat: clone type selection — posts/dm/both wizard"
```

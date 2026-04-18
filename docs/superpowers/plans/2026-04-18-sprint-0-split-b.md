# Sprint 0 Split B Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Sprint 0 by delivering 9 UI cleanup items across 5 screens + plug Plausible tracking with 6 custom events.

**Architecture:** Seven independent commits ordered cleanup-first, tracking-last. Each commit is scoped to one screen or one concern. No DB migrations. One minimal backend extension (`/api/share` GET SELECT). The tracking helper is a noop-safe wrapper around `window.plausible`.

**Tech Stack:** SvelteKit 5 (runes), Supabase (PG), Plausible Cloud, Node test runner.

**Spec reference:** [2026-04-18-sprint-0-split-b-design.md](../specs/2026-04-18-sprint-0-split-b-design.md)

---

## Ground rules

- **Verification for Svelte UI changes** = `npm run build` (type/syntax check) + manual smoke via `npm run dev` on the touched route. No Svelte component tests exist in the project and we don't introduce a framework here.
- **Verification for JS helpers and API endpoints** = node test runner (`npm run test`). New tests go in `test/`.
- **⚠️ `vite dev` does NOT serve `api/`** — the backend runs as Vercel serverless functions. For any task touching `api/*` or firing POSTs to `/api/*`, verification via `npm run dev` alone is insufficient (Split A incident 2026-04-17: missing `await` in `/api/chat` stayed invisible for 24h). Use **`vercel dev`** (or a Vercel preview deploy) on Tasks 4 and 7.
- **Commit at the end of each task** — each task = one commit matching the spec's commit list.
- **Do not touch adjacent code.** If you spot unrelated dead code, mention it; don't delete.
- **No new abstractions.** If it's 10 lines of inline code, keep them inline.

### Task 0 (prereq): ensure `vercel dev` works

Before starting Task 4 (earliest task touching `api/`), run:

```bash
npx vercel dev
```

Expected: dev server boots on port 3000, serves both `src/routes/` and `api/*.js`. Open `http://localhost:3000/api/personas` with a valid session header → 200 JSON response.

If `vercel dev` is not available or misconfigured, stop and surface to the user. Do not claim Task 4 or Task 7 complete from `vite dev` alone.

---

## Chunk 1: Commits 1–3 (cleanup, create, calibrate)

### Task 1: Dead code cleanup

**Files:**
- Delete: `src/lib/components/PersonaCard.svelte`
- Delete: `src/lib/components/ScenarioPill.svelte`

- [ ] **Step 1.1: Confirm zero imports**

Run: `grep -rn "PersonaCard\|ScenarioPill" src/ api/ lib/`
Expected: no matches.

- [ ] **Step 1.2: Delete both files**

```bash
rm src/lib/components/PersonaCard.svelte src/lib/components/ScenarioPill.svelte
```

- [ ] **Step 1.3: Build**

Run: `npm run build`
Expected: build succeeds, no broken import errors.

- [ ] **Step 1.4: Commit**

```bash
git add -A
git commit -m "chore(cleanup): remove dead PersonaCard, ScenarioPill components"
```

---

### Task 2: `/create` — kill calibration step, swap type to step 1, dedupe scrape

**Files:**
- Modify: `src/routes/create/+page.svelte`

- [ ] **Step 2.1: Update initial state**

Edit `src/routes/create/+page.svelte` line 9:

Replace:
```js
let step = $state('calibration');
```

With:
```js
let step = $state('type');
```

- [ ] **Step 2.2: Update steps derivation**

Replace lines 12-22:

```js
const steps = $derived([
  'calibration',
  'type',
  'info',
  ...(cloneType !== 'dm'    ? ['posts'] : []),
  ...(cloneType !== 'posts' ? ['dm']    : []),
  'docs',
]);
const TOTAL = $derived(steps.length);
// Steps that appear in the visible progress bar (exclude pre-steps)
const BARRED_STEPS = $derived(steps.filter(s => s !== 'calibration' && s !== 'type'));
```

With:
```js
const steps = $derived([
  'type',
  'info',
  ...(cloneType !== 'dm'    ? ['posts'] : []),
  ...(cloneType !== 'posts' ? ['dm']    : []),
  'docs',
]);
const TOTAL = $derived(steps.length);
```

- [ ] **Step 2.3: Update progress bar block**

Replace lines 208-217:

```svelte
<p class="create-subtitle">
  {#if step !== 'calibration' && step !== 'type'}
    Étape {BARRED_STEPS.indexOf(step) + 1}/{BARRED_STEPS.length}
  {/if}
</p>
<div class="step-bar" aria-hidden={step === 'calibration' || step === 'type'}>
  {#each BARRED_STEPS as s, i}
    <div class="step-bar-item" class:active={BARRED_STEPS.indexOf(step) >= i}></div>
  {/each}
</div>
```

With:
```svelte
<p class="create-subtitle">
  Étape {steps.indexOf(step) + 1}/{TOTAL}
</p>
<div class="step-bar">
  {#each steps as _, i}
    <div class="step-bar-item" class:active={steps.indexOf(step) >= i}></div>
  {/each}
</div>
```

- [ ] **Step 2.4: Delete the calibration step block**

Delete lines 225-311 entirely (the `{#if step === 'calibration'}` branch, including the rubric `<ol>`, the `.calib-primary` div, `.calib-secondary`, and the actions). The `{:else if step === 'type'}` that follows becomes the new opening `{#if step === 'type'}`.

- [ ] **Step 2.5: Remove orphaned CSS**

In the `<style>` block, delete these class rules (now unreferenced):
- `.rubric`, `.rubric-row`, `.rubric-row:last-child`, `.rubric-idx`, `.rubric-body`, `.rubric-name`, `.rubric-desc`, `.rubric-src`
- `.calib-divider`
- `.calib-primary`, `.calib-label`
- `.btn-primary`, `.btn-primary:hover:not(:disabled)`, `.btn-primary:disabled`
- `.calib-recap`, `.recap-line`, `.recap-line .mono`
- `.calib-secondary`
- `.link-btn`, `.link-btn:hover`

Keep `.recap-item` / `.recap-label` (used by `generate-recap` in step `docs`).

- [ ] **Step 2.6: Build**

Run: `npm run build`
Expected: build succeeds. No unused-selector warnings for the deleted classes.

- [ ] **Step 2.7: Smoke test**

Run: `npm run dev`
Open `/create` in browser:
- Lands directly on type cards (no rubric shown).
- Progress bar shows `1/4` on type step.
- Click `Posts LinkedIn` → step info → progress shows `2/4`.
- Scrape input visible on info step (only once, no duplicate).
- Back button works on all transitions.
- Click `Les deux` → `1/5` on type, posts + dm steps both present.

- [ ] **Step 2.8: Commit**

```bash
git add src/routes/create/+page.svelte
git commit -m "feat(create): kill calibration step, swap type to step 1, dedupe scrape input"
```

---

### Task 3: `/calibrate` — 3-option rating + contextual header

**Files:**
- Modify: `src/routes/calibrate/[persona]/+page.svelte`

- [ ] **Step 3.1: Add persona state + load**

Edit `src/routes/calibrate/[persona]/+page.svelte`.

Add below line 14 (`let submitting = $state(false);`):

```js
let persona = $state(null);
```

Replace the body of `loadCalibration` (lines 20-36):

```js
async function loadCalibration(pid) {
  loading = true;
  loadError = "";

  try {
    const [calibData, personaData] = await Promise.all([
      api("/api/calibrate", { method: "POST", body: JSON.stringify({ persona: pid }) }),
      api(`/api/config?persona=${pid}`),
    ]);
    messages = calibData.messages;
    ratings = calibData.messages.map(() => ({ score: 0, correction: "" }));
    persona = personaData.persona || personaData || null;
  } catch {
    loadError = "Calibration indisponible. Vous pouvez passer.";
  } finally {
    loading = false;
  }
}
```

Note: `/api/config?persona=<id>` returns either `{ persona, ... }` or the persona directly depending on the endpoint shape — the fallback `personaData` handles both.

- [ ] **Step 3.2: Contextual header**

Replace lines 84-94 (the `<header class="cal-head">` block):

```svelte
<header class="cal-head">
  <div class="brand">
    <span class="brand-mark">◎</span>
    <span class="brand-name">VoiceClone</span>
    <span class="brand-sub">/ calibration</span>
    {#if persona}
      <span class="brand-context">· {persona.name}{persona.type ? ` · ${persona.type}` : ''}</span>
    {/if}
  </div>
  <nav class="head-meta mono">
    <span class="kv"><span class="k">essais</span><span class="v">{messages.length || "—"}</span></span>
    <span class="kv"><span class="k">notés</span><span class="v">{scoredCount}/{messages.length || "—"}</span></span>
  </nav>
</header>
```

Add CSS rule in `<style>` (after `.brand-sub`):

```css
.brand-context {
  color: var(--ink-70);
  font-size: var(--fs-tiny);
  margin-left: 6px;
}
```

- [ ] **Step 3.3: Replace rating buttons**

Replace lines 139-150 (the `<div class="cal-rating">` block):

```svelte
<div class="cal-rating" role="radiogroup" aria-label="Note {i + 1}">
  {#each [['👎', 1, 'Note négative'], ['🤔', 3, 'Note mitigée'], ['👍', 5, 'Note positive']] as [emoji, scoreValue, aria]}
    <button
      class="rate-btn"
      class:selected={score === scoreValue}
      onclick={() => setRating(i, scoreValue)}
      aria-label={aria}
      aria-pressed={score === scoreValue}
    >{emoji}</button>
  {/each}
</div>
```

- [ ] **Step 3.4: Update trial-score display**

Replace lines 127-131:

```svelte
{#if score > 0}
  <span class="trial-score mono" class:high={score >= 4} class:low={score <= 2}>
    {score}/5
  </span>
{/if}
```

With:
```svelte
{#if score > 0}
  <span class="trial-score" class:high={score === 5} class:low={score === 1}>
    {score === 5 ? '👍' : score === 3 ? '🤔' : '👎'}
  </span>
{/if}
```

- [ ] **Step 3.5: Adjust rate-btn CSS for emoji**

In `<style>`, update `.rate-btn` (lines 340-351):

```css
.rate-btn {
  width: 44px;
  height: 36px;
  background: transparent;
  border: 1px solid var(--rule-strong);
  color: var(--ink);
  font-size: 18px;
  cursor: pointer;
  transition: all var(--dur-fast) var(--ease);
}
.rate-btn:hover { border-color: var(--ink-40); transform: translateY(-1px); }
.rate-btn.selected {
  background: var(--paper-subtle);
  border-color: var(--ink);
}
```

Remove the now-unused `.rate-btn.active` rule.

- [ ] **Step 3.6: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3.7: Smoke test**

Run: `npm run dev`
Open `/calibrate/<any-existing-persona-id>`:
- Header shows `VoiceClone / calibration · <PersonaName> · <type>`.
- Three emoji buttons displayed (👎 🤔 👍) instead of 5 digits.
- Click 👍 → trial-score badge shows 👍 in green.
- Click 👎 → badge shows 👎 in vermillon.
- Submit → backend receives scores 1/3/5 (check network tab).

- [ ] **Step 3.8: Commit**

```bash
git add src/routes/calibrate/[persona]/+page.svelte
git commit -m "feat(calibrate): 3-option emoji rating + contextual header (persona name + type)"
```

---

## Chunk 2: Commits 4–6 (share, hub, admin)

### Task 4: `/share` — sharer identity + claimed → chat direct

**Files:**
- Modify: `api/share.js`
- Modify: `src/routes/share/[token]/+page.svelte`
- Test: `test/api-share-sharer-name.test.js` (new, optional but recommended)

- [ ] **Step 4.1: Verify FK relationship name in Supabase**

Run this query in Supabase SQL editor or via psql:
```sql
SELECT conname FROM pg_constraint WHERE conrelid = 'share_tokens'::regclass AND contype = 'f';
```

Note the constraint name that references `created_by → clients(id)`. Likely `share_tokens_created_by_fkey`. If different, adjust the SELECT syntax in step 4.2.

- [ ] **Step 4.2: Extend GET /api/share SELECT**

Edit `api/share.js` lines 51-54. Replace:

```js
const { data: st } = await supabase
  .from("share_tokens")
  .select("persona_id, expires_at, personas(name, title, avatar)")
  .eq("token", token)
  .single();
```

With:
```js
const { data: st } = await supabase
  .from("share_tokens")
  .select("persona_id, expires_at, personas(name, title, avatar), creator:clients!share_tokens_created_by_fkey(name)")
  .eq("token", token)
  .single();
```

If the foreign-key name differs, substitute it. Fallback syntax if the hint fails: `creator:created_by(name)`.

- [ ] **Step 4.3: Return shared_by_name**

Edit `api/share.js` lines 73-77. Replace:

```js
res.json({
  persona: st.personas,
  persona_id: st.persona_id,
  already_shared: alreadyShared,
});
```

With:
```js
res.json({
  persona: st.personas,
  persona_id: st.persona_id,
  shared_by_name: st.creator?.name || null,
  already_shared: alreadyShared,
});
```

- [ ] **Step 4.4: Wire state in share page**

Edit `src/routes/share/[token]/+page.svelte`.

Add below line 8 (`let claiming = $state(false);`):

```js
let sharedByName = $state(null);
```

In `loadPreview` (after `const data = await resp.json();`), before the `persona = data.persona;` line, add:

```js
sharedByName = data.shared_by_name || null;
```

- [ ] **Step 4.5: Display sharer in preview state**

Replace lines 100-110 (the `{:else if state === "preview"}` block):

```svelte
{:else if state === "preview"}
  <div class="persona-preview">
    <div class="avatar">{persona?.avatar || "?"}</div>
    <h2>{persona?.name || "Clone"}</h2>
    {#if persona?.title}<p class="muted">{persona.title}</p>{/if}
    {#if sharedByName}
      <p class="shared-by">Partagé par <strong>{sharedByName}</strong></p>
    {/if}
  </div>
  <p>On vous partage ce clone. Voulez-vous l'ajouter a votre compte ?</p>
  <button class="btn-primary" onclick={claimShare} disabled={claiming}>
    {claiming ? "..." : "Ajouter a mes clones"}
  </button>
```

Add CSS rule before `</style>`:
```css
.shared-by {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin: 0.25rem 0 0.75rem;
}
.shared-by strong {
  color: var(--text-secondary);
  font-weight: 600;
}
```

- [ ] **Step 4.6: Replace claimed state buttons**

Replace lines 119-123 (the `{:else if state === "claimed"}` block):

```svelte
{:else if state === "claimed"}
  <h2>Clone ajouté !</h2>
  <p class="muted">Tu peux commencer à l'utiliser directement.</p>
  <button class="btn-primary" onclick={() => goto(`/chat/${personaId}`)}>
    Ouvrir chat direct
  </button>
```

- [ ] **Step 4.7: Add minimal node test for shared_by_name shape (optional)**

Create `test/api-share-sharer-name.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

// Contract test: ensure the GET /api/share handler returns shared_by_name in its response shape.
// This is a shape test only — no real Supabase call.
test("share GET response shape includes shared_by_name", () => {
  const sample = {
    persona: { name: "X" },
    persona_id: "id",
    shared_by_name: "Alice",
    already_shared: false,
  };
  assert.ok("shared_by_name" in sample, "response must include shared_by_name");
  assert.equal(typeof sample.shared_by_name, "string");
});
```

Run: `npm run test -- --test-name-pattern=shared_by_name`
Expected: 1 pass.

- [ ] **Step 4.8: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4.9: Smoke test via `vercel dev` (requires two accounts)**

⚠️ **Use `npx vercel dev`, NOT `npm run dev`** — this task touches `api/share.js` and `vite dev` does not serve it. Skipping this will hide backend regressions (lesson from Split A).

Run: `npx vercel dev`
- As user A: go to `/hub`, click `Partager` on a clone, copy link.
- Logout, login as user B.
- Open share link.
- Expected: preview shows persona AND line `Partagé par <User A name>`.
- Click `Ajouter a mes clones`.
- Expected: claimed state, button `Ouvrir chat direct` visible.
- Click button → lands on `/chat/<persona_id>`.

Verify in DevTools Network that the `GET /api/share?token=...` response JSON includes `shared_by_name` with a non-null string value. If `shared_by_name` is `null` when you know the sharer exists, the Supabase `creator:clients!...` join syntax is wrong — revisit step 4.2 and test alternative FK-name variants until the join resolves.

If you have only one test account: trigger the GET directly via curl with the access code header and inspect the JSON.

- [ ] **Step 4.10: Commit**

```bash
git add api/share.js src/routes/share/[token]/+page.svelte test/api-share-sharer-name.test.js
git commit -m "feat(share): sharer identity in preview + claimed state opens chat direct"
```

---

### Task 5: `/hub` — "+ Créer" in header

**Files:**
- Modify: `src/routes/hub/+page.svelte`

- [ ] **Step 5.1: Add header action button**

In `src/routes/hub/+page.svelte`, edit lines 135-141 (the `<nav class="head-meta mono">` block). Insert a `{#if}` button after the admin kv, inside the same nav:

```svelte
<nav class="head-meta mono">
  <span class="kv"><span class="k">clones</span><span class="v">{personaConfigs.length}</span></span>
  {#if $isAdmin}
    <span class="kv kv-admin"><span class="dot"></span><span class="v">admin</span></span>
  {/if}
  {#if $canCreateClone || $isAdmin}
    <button class="head-action" onclick={() => goto("/create")}>+ Créer</button>
  {/if}
</nav>
```

- [ ] **Step 5.2: Style the header action**

In `<style>`, add after the `.kv-admin .dot` / `@keyframes admin-pulse` block:

```css
.head-action {
  padding: 2px 10px;
  font-family: var(--font-mono);
  font-size: var(--fs-tiny);
  color: var(--ink);
  background: transparent;
  border: 1px solid var(--rule-strong);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
  line-height: 1.4;
}
.head-action:hover { border-color: var(--vermillon); color: var(--vermillon); }
```

- [ ] **Step 5.3: Remove the "Nouveau clone" bottom section**

Delete lines 252-263:

```svelte
{#if $canCreateClone || $isAdmin}
  <section class="hub-section">
    <h2 class="hub-section-title">Nouveau clone</h2>
    <button class="action-card" onclick={() => goto("/create")} transition:fly={{ y: 12, delay: personaConfigs.length * 80 + 40, duration: 200 }}>
      <div class="action-icon">+</div>
      <div class="action-info">
        <strong>Créer un clone</strong>
        <span>A partir d'un profil de reseau social</span>
      </div>
    </button>
  </section>
{/if}
```

- [ ] **Step 5.4: Adjust transition delays downstream**

The following sections referenced `personaConfigs.length * 80 + 40/120/200` in their `transition:fly` delays. Since we removed the 40-offset section, shift the others down:

- Admin section (was `+ 120`) → change to `+ 40`
- Ressources section (was `+ ($isAdmin ? 200 : 120)`) → change to `+ ($isAdmin ? 120 : 40)`

This keeps the stagger tight without the gap left by the removed card.

- [ ] **Step 5.5: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5.6: Smoke test**

Run: `npm run dev`
Open `/hub`:
- `+ Créer` button visible in top-right next to `clones` counter (if user can create).
- Click → navigates to `/create`.
- Bottom of hub page: no duplicate "Nouveau clone" section.
- Existing "Administration" and "Ressources" sections still render with sane animation staggering.

- [ ] **Step 5.7: Commit**

```bash
git add src/routes/hub/+page.svelte
git commit -m "feat(hub): promote + Créer to header, remove duplicate bottom section"
```

---

### Task 6: `/admin` — sort personas fidelity ASC + color badge

**Files:**
- Modify: `src/routes/admin/+page.svelte`

- [ ] **Step 6.1: Add sorted derived**

Edit `src/routes/admin/+page.svelte`. Add after line 13 (`let activity = $state([]);`):

```js
let sortedPersonas = $derived(
  [...personasList].sort((a, b) => {
    const sa = a.fidelity?.score_global ?? 999;
    const sb = b.fidelity?.score_global ?? 999;
    return sa - sb;
  })
);
```

- [ ] **Step 6.2: Use sortedPersonas in the each block**

Edit line 167:

Replace:
```svelte
{#each personasList as p}
```

With:
```svelte
{#each sortedPersonas as p}
```

- [ ] **Step 6.3: Add badge in persona header, remove bottom fidelity line**

Replace lines 168-193 (the entire `.persona-card` content block):

```svelte
<div class="persona-card">
  <div class="persona-header">
    <span class="persona-avatar">{p.avatar || "?"}</span>
    <div class="persona-header-info">
      <strong class="persona-name">{p.name}</strong>
      <span class="persona-owner">{p.client_name}</span>
    </div>
    {#if p.fidelity}
      <span
        class="fid-badge"
        class:fid-ok={p.fidelity.score_global >= 75}
        class:fid-warn={p.fidelity.score_global >= 50 && p.fidelity.score_global < 75}
        class:fid-bad={p.fidelity.score_global < 50}
        title="Fidélité composite: {p.fidelity.score_global}"
      >
        {p.fidelity.score_global}
      </span>
    {/if}
  </div>
  <div class="persona-stats">
    <div class="persona-stat">
      <span class="persona-stat-val">{p.conversations}</span>
      <span class="persona-stat-lbl">conv.</span>
    </div>
    <div class="persona-stat">
      <span class="persona-stat-val">{p.corrections}</span>
      <span class="persona-stat-lbl">corrections</span>
    </div>
    <div class="persona-stat">
      <span class="persona-stat-val">{p.entities}</span>
      <span class="persona-stat-lbl">entites</span>
    </div>
  </div>
</div>
```

Note: wrapper `.persona-header-info` replaces the unnamed `<div>` to give the name+owner column a stable flex slot, with the badge landing to the right.

- [ ] **Step 6.4: Update CSS**

In `<style>`:

Change `.persona-header` rule (around line 412):

```css
.persona-header {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  margin-bottom: 0.625rem;
}
.persona-header-info {
  min-width: 0;
  flex: 1;
}
```

Remove the `.admin-fidelity` rule (lines 467-471).

Add badge rules before `/* Activity feed */` comment:

```css
.fid-badge {
  padding: 2px 8px;
  font-size: 0.6875rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  border: 1px solid;
  flex-shrink: 0;
}
.fid-ok { border-color: var(--text-tertiary); color: var(--text); }
.fid-warn { border-color: #b87300; color: #b87300; }
.fid-bad { border-color: var(--vermillon, #e03131); color: var(--vermillon, #e03131); }
```

- [ ] **Step 6.5: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6.6: Smoke test**

Run: `npm run dev`
Login as admin, open `/admin`:
- Personas section: cards ordered from lowest to highest `score_global` (first card = worst fidelity).
- Each card shows a badge in top-right with the numeric score, colored by threshold:
  - `< 50` → red
  - `50-74` → amber
  - `≥ 75` → neutral
- Personas with no fidelity data appear last without a badge.

- [ ] **Step 6.7: Commit**

```bash
git add src/routes/admin/+page.svelte
git commit -m "feat(admin): sort personas by fidelity ASC + color-coded score badge"
```

---

## Chunk 3: Commit 7 (tracking)

### Task 7: Plausible + 6 custom events

**Files:**
- Modify: `src/app.html`
- Modify: `.env.example`
- Create: `src/lib/tracking.js`
- Create: `test/tracking.test.js`
- Modify: `src/routes/create/+page.svelte`
- Modify: `src/routes/chat/[persona]/+page.svelte`
- Modify: `src/routes/calibrate/[persona]/+page.svelte`
- Modify: `src/routes/hub/+page.svelte`
- Modify: `src/routes/share/[token]/+page.svelte`
- Modify: `src/lib/components/ScenarioSwitcher.svelte`

- [ ] **Step 7.1: Confirm Plausible domain with user**

Before starting, ask the user which domain Plausible will track (e.g., `app.voiceclone.xyz`). Add it to their Plausible account dashboard. Set `VITE_PLAUSIBLE_DOMAIN=<domain>` in their local `.env`.

- [ ] **Step 7.2: Add `.env.example` entry**

Edit `.env.example` — add at the bottom:

```
# Plausible Analytics (leave unset in local dev to disable tracking)
VITE_PLAUSIBLE_DOMAIN=
```

- [ ] **Step 7.3: Inject Plausible script in app.html**

Edit `src/app.html`. Inside `<head>`, before `%sveltekit.head%`, add:

```html
<script defer data-domain="%VITE_PLAUSIBLE_DOMAIN%" src="https://plausible.io/js/script.tagged-events.js"></script>
<script>window.plausible = window.plausible || function() { (window.plausible.q = window.plausible.q || []).push(arguments) }</script>
```

Note on Vite placeholder: SvelteKit replaces `%VITE_PLAUSIBLE_DOMAIN%` at build time with the env var value. If unset, the attribute becomes empty and Plausible sends nothing (safe no-op).

- [ ] **Step 7.4: Create tracking helper**

Create `src/lib/tracking.js`:

```js
// Noop-safe wrapper around window.plausible.
// - SSR-safe: bails out when window is undefined.
// - Adblock-safe: bails out when plausible is not injected.
// - Dev-safe: logs to console when VITE_PLAUSIBLE_DOMAIN is unset.

export function track(event, props = {}) {
  if (typeof window === 'undefined') return;
  if (typeof window.plausible !== 'function') return;
  try {
    window.plausible(event, { props });
  } catch {
    // Silent — tracking never breaks UX.
  }
}
```

- [ ] **Step 7.5: Write test for tracking helper**

Create `test/tracking.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { track } from "../src/lib/tracking.js";

test("track() is noop when window is undefined (SSR)", () => {
  // In node context, window is undefined by default.
  assert.doesNotThrow(() => track("clone_created", { type: "posts" }));
});

test("track() is noop when plausible is missing", () => {
  globalThis.window = {};
  assert.doesNotThrow(() => track("clone_created"));
  delete globalThis.window;
});

test("track() calls window.plausible with event + props", () => {
  const calls = [];
  globalThis.window = {
    plausible: (event, opts) => calls.push([event, opts]),
  };
  track("clone_created", { type: "posts", has_docs: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "clone_created");
  assert.deepEqual(calls[0][1], { props: { type: "posts", has_docs: true } });
  delete globalThis.window;
});

test("track() swallows errors from plausible()", () => {
  globalThis.window = {
    plausible: () => { throw new Error("boom"); },
  };
  assert.doesNotThrow(() => track("x"));
  delete globalThis.window;
});
```

- [ ] **Step 7.6: Run tracking tests**

Run: `npm run test -- --test-name-pattern=track`
Expected: 4 passes.

- [ ] **Step 7.7: Event 1 — `clone_created`**

Edit `src/routes/create/+page.svelte`.

Add at the top of `<script>`:
```js
import { track } from "$lib/tracking.js";
```

After `persona = data.persona;` (line ~137, right before the `} catch` block closes and Phase 2 begins), add:
```js
track("clone_created", { type: cloneType, has_docs: pendingFiles.filter(f => f.status === "pending").length > 0 });
```

- [ ] **Step 7.8: Event 2 — `message_sent`**

Edit `src/routes/chat/[persona]/+page.svelte`.

Add the import:
```js
import { track } from "$lib/tracking.js";
```

Find the function that submits the user's message (likely `sendMessage`, `handleSend`, or similar). After the POST to the chat API succeeds (or right when the user message is added to local state — wherever is the "sent" moment), add:
```js
track("message_sent", { scenario_type: currentScenario || 'default', persona_id: personaId });
```

Variable names (`currentScenario`, `personaId`) should be adapted to what's in scope in that file. If unclear, use `grep -n "api.*chat\|POST.*chat" src/routes/chat/[persona]/+page.svelte` to locate the send site.

- [ ] **Step 7.9: Event 3 — `correction_submitted`**

Two call sites.

**Calibrate submit:** edit `src/routes/calibrate/[persona]/+page.svelte`, in `submitCalibration`, right after the successful API call (after `if (data.message) showToast(data.message);`):

```js
import { track } from "$lib/tracking.js"; // add at top
// ...
track("correction_submitted", { source: 'calibrate' });
```

**Chat inline correction:** edit `src/routes/chat/[persona]/+page.svelte`. Find the handler for inline corrections (search for `correction` or `/api/feedback` in that file). After success:
```js
track("correction_submitted", { source: 'chat' });
```

If the chat page doesn't already have a visible correction handler, skip the chat call site and note it in the commit message — a follow-up will wire it once corrections have a clear UI entry point. The calibrate site alone is sufficient to validate the event.

- [ ] **Step 7.10: Event 4 — `share_created`**

Edit `src/routes/hub/+page.svelte`.

Add the import:
```js
import { track } from "$lib/tracking.js";
```

In `shareClone`, after `const { token } = await resp.json();`:
```js
track("share_created", { persona_id: personaId });
```

- [ ] **Step 7.11: Event 5 — `share_claimed`**

Edit `src/routes/share/[token]/+page.svelte`.

Add the import:
```js
import { track } from "$lib/tracking.js";
```

In `claimShare`, after `state = "claimed";`:
```js
track("share_claimed");
```

- [ ] **Step 7.12: Event 6 — `scenario_switched`**

Edit `src/lib/components/ScenarioSwitcher.svelte`.

Add the import:
```js
import { track } from "$lib/tracking.js";
```

Find the function or inline handler that fires when the user picks a new scenario (likely on a `<select onchange>` or a button `onclick`). Before or after the change is propagated, capture `from` and `to` and emit:
```js
track("scenario_switched", { from: previousScenario, to: newScenario });
```

If the switcher only knows the new scenario (not the previous), either store the previous in a local `$state` initialized from the current prop, or emit `{ to }` only and document this in the commit message.

- [ ] **Step 7.13: Build**

Run: `npm run build`
Expected: build succeeds, no import errors.

- [ ] **Step 7.14: Run all tests**

Run: `npm run test`
Expected: all tests pass. New tracking tests (4) pass.

- [ ] **Step 7.15: Smoke test events via `vercel dev`**

⚠️ **Use `npx vercel dev`, NOT `npm run dev`** — 4 of the 6 events fire inside flows that POST to `api/*` (create, message, correction, share). Testing on `vite dev` would let API-side regressions slip through.

Set `VITE_PLAUSIBLE_DOMAIN` to your dashboard's domain and run: `npx vercel dev`

Open DevTools → Network tab, filter on `plausible.io/api/event`.

Trigger each event in order and confirm a POST request fires:
1. `/create` → complete a clone creation → `clone_created` POST visible + clone actually persisted (check `/hub` reflects the new clone, not just the event).
2. `/chat/<persona>` → send a message → `message_sent` POST visible + bot response arrives (i.e. `/api/chat` actually ran).
3. `/calibrate/<persona>` → submit → `correction_submitted` POST with `source: "calibrate"` + backend confirms via toast.
4. `/hub` → click Partager → `share_created` POST + token URL copied to clipboard.
5. Open the share link (different browser) → claim → `share_claimed` POST + clone appears in claimant's hub.
6. Switch scenario in chat → `scenario_switched` POST.

If Plausible domain is not configured, the plausible.io POSTs will not fire — this is expected. In that case, manually invoke `window.plausible('clone_created', { props: { type: 'posts' } })` in the console to verify the script loaded. The API-side flows (create persona, send message, etc.) must still succeed regardless of Plausible configuration.

- [ ] **Step 7.16: Commit**

```bash
git add .env.example src/app.html src/lib/tracking.js test/tracking.test.js src/routes/create/+page.svelte src/routes/chat/[persona]/+page.svelte src/routes/calibrate/[persona]/+page.svelte src/routes/hub/+page.svelte src/routes/share/[token]/+page.svelte src/lib/components/ScenarioSwitcher.svelte
git commit -m "feat(tracking): Plausible + 6 custom events (clone/message/correction/share×2/scenario)"
```

---

## Final checklist

After all 7 commits:

- [ ] `git log --oneline -7` shows the 7 expected commits in order.
- [ ] `npm run build` from master succeeds.
- [ ] `npm run test` passes.
- [ ] Manual smoke test of the 5 touched screens (`/create`, `/calibrate`, `/share`, `/hub`, `/admin`) shows no regressions.
- [ ] Plausible dashboard shows custom events arriving within 24h of real usage.

---

## Rollback plan

Each commit is surgical and independent. To revert any single task:

```bash
git revert <commit-sha>
```

The tracking commit is the only one touching multiple unrelated files; if a bug surfaces in one of the call sites, prefer a targeted fix rather than a full revert of commit 7.

# Clone Type Selection — Design Spec

**Date:** 2026-04-16  
**Status:** Approved

## Problem

When creating a clone, users are currently forced through a fixed 4-step wizard regardless of their intent. A clone meant only for DM prospection shouldn't require LinkedIn posts, and a clone meant only for posts doesn't need DM conversations. There's no way to express intent upfront.

## Goal

Add a type selection step at the start of clone creation so the wizard adapts dynamically to the user's use case.

---

## Solution

### Approach: Dynamic `cloneType` flag (chosen)

Add a `cloneType: 'posts' | 'dm' | 'both'` variable in the wizard state. The step array is derived from this value, so irrelevant steps are completely removed from the flow.

Rejected alternatives:
- **Visible/hidden steps:** More complex, marginal benefit for 2 variable steps.
- **Separate routes per type:** Too much code duplication (info + docs steps are identical).

---

## Step 0 — Type Selection UI

**Screen:** Full-width, centered, same dark theme as the existing wizard.

**Title:** `"Pourquoi créer ce clone ?"`  
**Subtitle:** `"Le flow de création s'adapte selon ton choix."`

**Three clickable cards:**

| Value | Icon | Label | Description |
|-------|------|-------|-------------|
| `posts` | ✍️ | Posts LinkedIn | Génère du contenu écrit, hooks, carrousels |
| `dm` | 💬 | DMs LinkedIn | Répond en prospection et qualification |
| `both` | ⚡ | Les deux | Flow complet, 5 étapes |

Clicking a card selects it and reveals a "Continuer" button.

---

## Dynamic Step Flow

The wizard step array is derived from `cloneType`:

```js
const steps = $derived([
  'type',
  'info',
  ...(cloneType !== 'dm'    ? ['posts'] : []),
  ...(cloneType !== 'posts' ? ['dm']    : []),
  'docs'
]);
const TOTAL = $derived(steps.length);
```

**Posts only** (4 steps): type → info → posts → docs  
**DMs only** (4 steps): type → info → dm → docs  
**Both** (5 steps): type → info → posts → dm → docs

### Navigation

All navigation must use step name or index into the `steps` array — **no hardcoded step integers**. The existing `goToStep(n)` calls with literal integers (e.g. `goToStep(2)`, `goToStep(3)`) must be replaced with index lookups:

```js
// Navigate to next step
function nextStep() { step = steps[steps.indexOf(step) + 1]; }
// Navigate to previous step
function prevStep() { step = steps[steps.indexOf(step) - 1]; }
```

The `step` variable changes from an integer to a step name string. The step counter display (`"Étape X / Y"`) and progress bar segments use `steps.indexOf(step) + 1` for the current position and `steps.length` for the total.

### Back-navigation and type change

If the user returns to step 0 (`type`) and changes `cloneType`, any data entered in the now-excluded step is **cleared**:

```js
function setCloneType(value) {
  cloneType = value;
  if (value === 'dm')    postsText = '';
  if (value === 'posts') dmsText = '';
}
```

This prevents silently submitting data the user no longer intends to include.

---

## Validation Changes

| Step | Current | New |
|------|---------|-----|
| Posts | Obligatoire (min 3 posts) | Obligatoire si `cloneType !== 'dm'`, absent sinon |
| DMs | Optionnel (skippable) | Obligatoire si `cloneType !== 'posts'`, absent sinon |

---

## UI Conditional Rendering

**Recap block (step `docs`):** The posts and DMs rows are shown conditionally:
- Show posts row only if `cloneType !== 'dm'`
- Show DMs row only if `cloneType !== 'posts'`

---

## Database

New column on `personas`:

```sql
ALTER TABLE personas
  ADD COLUMN type text NOT NULL DEFAULT 'both'
  CHECK (type IN ('posts', 'dm', 'both'));
```

`DEFAULT 'both'` ensures backward compatibility with existing clones — all existing rows get `'both'`, and new inserts without an explicit `type` also default to `'both'`. This migration must be deployed before any code that reads `personas.type` goes live.

**Why a dedicated column, not `voice` JSONB:** `type` is a structural property that determines which scenarios exist and how the clone behaves. It will be queryable for filtering. `voice` describes personality and writing style — a different concern.

---

## API Changes

**`/api/clone` (POST):**

1. **Destructure `cloneType` from request body:**
   ```js
   const { linkedin_text, posts, dms, documents, name, cloneType } = req.body || {};
   ```

2. **Make the posts validation guard conditional:**
   ```js
   // Current (line ~127):
   if (!posts || !Array.isArray(posts) || posts.length < 3) { ... }
   // New:
   if (cloneType !== 'dm' && (!posts || !Array.isArray(posts) || posts.length < 3)) { ... }
   ```

3. **Save `type` in the `personas` insert:**
   ```js
   const { data: persona } = await supabase
     .from('personas')
     .insert({ ..., type: cloneType || 'both' })
   ```

4. **Skip irrelevant scenario generation:** For `dm`-only clones, skip generating the "post" scenario. For `posts`-only clones, skip DM knowledge file generation (already handled — no `dms` data means no file is created).

---

## Files Affected

- `src/routes/create/+page.svelte` — Add step 0 UI, derive steps array and navigation from `cloneType`, replace hardcoded `goToStep(n)` calls, conditional recap rows
- `api/clone.js` — Destructure `cloneType`, make posts guard conditional, add `type` to personas insert, skip irrelevant scenario generation
- `supabase/schema.sql` or a new migration file — Add `type` column to `personas`

---

## Out of Scope

- Changing the scenario system (no new "dm" scenario slug in this iteration)
- Editing an existing clone's type after creation
- UI changes outside the creation wizard

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

**Title:** `"Pour quoi créer ce clone ?"`  
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

---

## Validation Changes

| Step | Current | New |
|------|---------|-----|
| Posts | Obligatoire (min 3 posts) | Obligatoire si `cloneType !== 'dm'`, absent sinon |
| DMs | Optionnel (skippable) | Obligatoire si `cloneType !== 'posts'`, absent sinon |

---

## Database

New column on `personas`:

```sql
ALTER TABLE personas
  ADD COLUMN type text NOT NULL DEFAULT 'both'
  CHECK (type IN ('posts', 'dm', 'both'));
```

`DEFAULT 'both'` ensures backward compatibility with existing clones.

**Why a dedicated column, not `voice` JSONB:** `type` is a structural property that determines which scenarios exist and how the clone behaves. It will be queryable for filtering. `voice` describes personality and writing style — a different concern.

---

## API Changes

**`/api/clone` (POST):** No logic changes. If posts data is absent, no `style-posts-linkedin.md` knowledge file is created. If DMs are absent, no `style-conversations.md` is created. This is already the current behavior.

`cloneType` is passed in the request body and saved to `personas.type`. The scenario generation can use it to skip the "post" scenario for DM-only clones.

---

## Files Affected

- `src/routes/create/+page.svelte` — Add step 0 UI, derive steps array from `cloneType`
- `api/clone.js` — Accept and store `cloneType`, skip irrelevant scenario generation
- `supabase/schema.sql` or a new migration file — Add `type` column to `personas`

---

## Out of Scope

- Changing the scenario system (no new "dm" scenario slug in this iteration)
- Editing an existing clone's type after creation
- UI changes outside the creation wizard

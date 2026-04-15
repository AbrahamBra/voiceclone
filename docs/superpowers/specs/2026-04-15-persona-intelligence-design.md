# Persona Intelligence Panel — Design Spec

## Overview

Add an "Intelligence" tab to the existing conversation sidebar in the chat screen. This tab shows corrections, knowledge graph entities, and learning stats for the current persona. It gives users visibility into what the clone has learned, and the ability to delete bad corrections.

**Why:** Today the learning loop is a black box. Users submit corrections but can't see what's active, can't delete mistakes, and can't see the knowledge graph. This feature makes the learning visible and controllable — the key differentiator that justifies premium pricing.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Panel location | Sidebar tab (alongside Conversations) | Stay in chat context, reuse existing 280px sidebar |
| Knowledge graph display | Simple list grouped by type | ~15-30 entities per persona, no need for d3/vis.js. YAGNI. |
| Correction deletion | Hard delete, no graph cleanup | Entities may have been reinforced by other corrections. Rollback is risky. |
| API structure | Extend `feedback.js` with GET + DELETE | One fetch loads everything; avoids Vercel 12-function limit |
| Pagination | None | 50 corrections + ~30 entities fits in a scroll |
| Client-side cache | None | One fetch per tab open, data is fresh |
| Real-time sync | None | Re-click tab to refresh. No WebSocket/polling. |

## Architecture

### API — Extended `feedback.js`

The intelligence endpoints are added to the existing `api/feedback.js` to stay within Vercel's 12-function limit. This file already imports `clearCache` and handles corrections, making it the natural home.

**`GET /api/feedback?persona={id}&view=intelligence`**

Returns all intelligence data for a persona in one payload.

Auth & ownership check:
1. `authenticateRequest(req)` → get `client`
2. Query `personas` where `id = personaId AND client_id = client.id` (or skip client_id check if `isAdmin`)
3. If no match → 403

Data loading: reuse `loadPersonaData(personaId)` from `knowledge-db.js` (already loads corrections, entities, relations with 5-min cache). Transform the cached data into the response shape:

```json
{
  "stats": {
    "corrections_total": 12,
    "entities_total": 24,
    "relations_total": 18,
    "confidence_avg": 0.82
  },
  "corrections": [
    {
      "id": "uuid",
      "correction": "Ne jamais utiliser le mot synergie",
      "user_message": "Parle-moi de teamwork",
      "bot_message": "La synergie entre les équipes...",
      "created_at": "2026-04-12T14:30:00Z"
    }
  ],
  "entities": [
    {
      "id": "uuid",
      "name": "React",
      "type": "tool",
      "description": "Framework JS préféré",
      "confidence": 0.95,
      "last_matched_at": "2026-04-14T10:00:00Z",
      "relations": [
        { "type": "uses", "target": "TypeScript", "confidence": 0.9 }
      ]
    }
  ]
}
```

- Corrections sorted by `created_at DESC`, sliced to 50 client-side (from cached array)
- Entities enriched with relations by mapping `relations` array against `entities` to resolve target names
- `confidence_avg` computed client-side: average of `entities.map(e => e.confidence)`

**`DELETE /api/feedback?persona={id}&correction={correctionId}`**

Auth & ownership:
1. Same persona ownership check as GET
2. Delete with: `DELETE FROM corrections WHERE id = correctionId AND persona_id = personaId`
   (double-check: correction must belong to the specified persona)
3. Calls `clearCache(personaId)` to invalidate knowledge-db cache
4. Returns `{ ok: true }`

Frontend decrements `corrections_total` locally after successful delete (no re-fetch needed).

**CORS:** `setCors(res, "GET, POST, DELETE, OPTIONS")` (extends existing POST).

### Frontend — Tab Switcher

Two buttons added to `.conv-sidebar-header`:
- "Conversations" (default active)
- "Intelligence"

Active tab has underline accent. Click toggles visibility between `.conv-list` (existing) and `.intelligence-panel` (new).

### Frontend — Intelligence Panel

Three vertically stacked sections inside `.intelligence-panel`:

**Stats block** (~60px, non-scrolling):
- 3 values in a row: corrections count | entities count | avg confidence
- Small labels in `--text-tertiary`, values in `--text`
- Bottom border separator

**Corrections block** (scrollable):
- Header "Corrections" with count
- Each item: relative date + text truncated to 80 chars + X delete button
- Click item → expand/collapse showing `user_message` and `bot_message` in `--text-secondary`
- Click X → inline confirmation ("Supprimer ?") → DELETE API → fade-out + toast + update stats counter
- Empty state: "Aucune correction. Utilisez le bouton Corriger sur les réponses."

**Entities block** (scrollable):
- Header "Connaissances" with count
- Grouped by entity type (concept, person, tool, company, etc.)
- Each entity: name + confidence bar (green >0.8, yellow >0.6, red otherwise) + relative last_matched_at
- Click → expand: description + relations listed ("utilise TypeScript (0.9)")

### Data Flow

1. User clicks "Intelligence" tab → `fetch GET /api/feedback?persona={currentPersonaId}&view=intelligence`
2. Loading state: spinner in sidebar
3. Response → render 3 blocks. On fetch error → show "Erreur de chargement" with retry link in sidebar.
4. Switch back to "Conversations" → toggle display (both panels stay in DOM)

**Correction deletion flow:**
1. Click X → button text becomes "Supprimer ?" (reverts to X after 4 seconds if no second click)
2. Click again → `fetch DELETE /api/feedback?persona={id}&correction={correctionId}`
3. Success → fade-out item, decrement stats counter locally, toast "Correction supprimée"
4. Error → toast error, button reverts to X

**After feedback submission:**
If Intelligence tab is visible when user submits a correction via "Corriger" button, no auto-refresh. User re-clicks tab to see update.

**Server cache invalidation:**
DELETE calls `clearCache(personaId)` in `knowledge-db.js` (same pattern as `feedback.js`).

## What We Don't Build

- No correction editing (delete and re-correct instead)
- No manual entity add/edit (automatic via feedback loop)
- No sorting/filtering UI (50 items max, scroll suffices)
- No client-side caching (one fetch per tab open)
- No real-time sync (no WebSocket, no polling)
- No graph visualization library (list is sufficient for ~30 entities)
- No pagination (scale doesn't require it)
- No cross-persona insight duplication (future feature if demand arises)

## Constraints

- **Vercel 12-function limit:** Intelligence logic lives in `feedback.js`, not a new file.
- **Mobile:** Sidebar is hidden at `max-width: 768px`. Intelligence tab is desktop-only. Acceptable for now — the primary use case is reviewing persona intelligence, which is a desktop workflow.
- **Entity group ordering:** Fixed order: concept, framework, tool, person, company, metric, belief. Groups with 0 entities are hidden.

## Files Changed

| File | Change |
|------|--------|
| `api/feedback.js` | Add GET + DELETE handlers alongside existing POST |
| `public/index.html` | Add tab switcher buttons + intelligence panel container |
| `public/style.css` | Tab switcher styles, intelligence panel styles, stats/corrections/entities blocks |
| `public/app.js` | Tab switching logic, fetch + render intelligence data, delete flow |
| `lib/knowledge-db.js` | Export `loadPersonaData()` for use by feedback.js GET handler |

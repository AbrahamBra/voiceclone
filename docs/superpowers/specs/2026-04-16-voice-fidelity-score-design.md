# Voice Fidelity Score — Design Spec

**Date:** 2026-04-16
**Status:** Draft
**Files:** new `lib/fidelity.js`, new `api/fidelity.js`, new `supabase/015_fidelity_scores.sql`, modified `IntelligencePanel.svelte`, modified `+page.svelte` (hub), modified `admin/+page.svelte`

## Problem

The metacognitive loop accumulates corrections, entities, and rules — but there's no measurable proof the clone is actually getting better at reproducing the human's voice. Users invest effort training their clone without knowing if it's working.

## Solution: Voice Fidelity Score

A cosine-similarity-based score comparing the clone's generated output against the original human's LinkedIn posts, calculated per theme and aggregated into a global score (0-100).

### Why This Design

| Decision | Rationale |
|----------|-----------|
| Embeddings, not LLM-as-judge | Deterministic, cheap, fast — consistent with project philosophy |
| Theme-based, not global | Reveals where the clone excels vs. struggles — actionable feedback |
| Reuse Voyage-3 + existing chunks | Zero new infra — posts already embedded in `chunks` table |
| Score stored with history | Enables trend visualization ("your clone improved 12 points this month") |

## Architecture

### Data Model: Post Chunks Are Approximate

**Important context:** During clone creation (`api/clone.js:433-436`), LinkedIn posts are concatenated into a single blob and then chunked by paragraph boundaries (~500 tokens). This means a single chunk may contain fragments from multiple posts. The chunks are NOT clean per-post embeddings.

**Impact on fidelity scoring:** Clustering these chunks still produces meaningful thematic groupings — paragraph-level semantic similarity is a reasonable proxy for post-level similarity. The score measures "how well the clone captures the thematic space of the human's writing" rather than "how well it reproduces individual posts." This is acceptable for v1. The cosine similarities will be slightly noisier than with per-post embeddings, but the trend over time (the most valuable metric) remains valid.

### Score Calculation Pipeline (`lib/fidelity.js`)

```
LinkedIn post chunks (chunks table, source_type="linkedin_post")
  → parse embeddings from JSON strings (PostgREST returns vector as string)
  → cluster by cosine similarity (threshold 0.70)
  → label each cluster with a theme name (Haiku, 1 call)
  → for each theme:
      pick representative chunk (closest to centroid)
      → generate clone response on same topic (Sonnet, ~100 tokens)
      → embed generated text (Voyage embed(), input_type="document")
      → cosine similarity vs. cluster centroid
  → global score = weighted mean (weight = cluster size)
  → rescale from realistic range [0.35, 0.90] to display range [0, 100]
```

#### Step-by-step

**1. Retrieve reference post chunks**
```js
const { data: posts } = await supabase
  .from("chunks")
  .select("id, content, embedding, metadata")
  .eq("persona_id", personaId)
  .eq("source_type", "linkedin_post");

// PostgREST returns vector(1024) as string — parse to number[]
const parsed = posts.map(p => ({
  ...p,
  embedding: JSON.parse(p.embedding)
}));
```

**2. Cluster by theme**

Reuse the greedy clustering algorithm from `lib/correction-consolidation.js` (cosineSim function + centroid accumulation), but with threshold 0.70 (slightly lower than corrections' 0.75 — post chunks are more diverse).

Minimum cluster size: 2 (not 3 — we want themes even with sparse data).

**3. Label themes**

Single Haiku call with all cluster centroids' representative chunks:

```
Given these groups of LinkedIn posts, give each group a short theme label (2-4 words).
Respond in the same language as the posts.
Group 1: [most-central chunk excerpt, 100 chars]
Group 2: [most-central chunk excerpt, 100 chars]
...
Return JSON: ["theme1", "theme2", ...]
```

Cost: ~500 input tokens, ~50 output tokens. Negligible.

**4. Generate clone text per theme**

For each theme, use the clone's full system prompt (voice + corrections + knowledge) to generate a short text:

```
Ecris un post LinkedIn court (3-4 phrases) sur le thème : [theme_label].
Contexte du post original : [representative_chunk_excerpt, 150 chars]
```

This uses the same prompt-building pipeline as chat (`lib/prompt.js`), ensuring the score reflects the clone's actual current capability including all learned corrections and rules.

**5. Compare embeddings**

Use `embed()` (not `embedQuery()`) for the generated text — both sides must use `input_type: "document"` for symmetric comparison. Voyage-3 produces asymmetric embeddings between query and document spaces; using `embedQuery` here would introduce systematic bias.

```js
// embed() takes an array — wrap single text
const [generated_embedding] = await embed([generated_text]);
const similarity = cosineSim(generated_embedding, cluster_centroid);
```

**6. Compute and rescale global score**

Raw cosine similarity for Voyage-3 typically falls in [0.35, 0.90] for related texts. A raw 0.72 would display as 72, but the score would never reach 100 and would floor around 35 even for unrelated text. Rescale to make the 0-100 range meaningful:

```js
const RAW_MIN = 0.35;  // floor for unrelated text
const RAW_MAX = 0.90;  // ceiling for near-identical style
const rawGlobal = themes.reduce((sum, t) => sum + t.similarity * t.weight, 0)
                / themes.reduce((sum, t) => sum + t.weight, 0);
const score = Math.round(Math.min(100, Math.max(0,
  ((rawGlobal - RAW_MIN) / (RAW_MAX - RAW_MIN)) * 100
)));
```

Weight = number of chunks in the cluster. Themes with more reference material count more.

These constants (RAW_MIN, RAW_MAX) are initial estimates. After collecting real data from 5-10 personas, calibrate against observed distribution.

#### Edge Cases

| Case | Handling |
|------|----------|
| Persona has < 3 post chunks | Return `null` — not enough data for meaningful score |
| Fewer than 2 clusters | Use all chunks as single cluster, return global only, flag `low_confidence: true` |
| Voyage API down or not configured | Return `null`, set `can_calculate: false` with reason |
| Clone generates refusal/off-topic | Score will naturally be low — no special handling needed |
| Embedding parse fails (malformed JSON) | Skip that chunk, log warning, continue with remaining |

### Database (`supabase/015_fidelity_scores.sql`)

```sql
CREATE TABLE fidelity_scores (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  persona_id uuid REFERENCES personas(id) ON DELETE CASCADE NOT NULL,
  score_global integer NOT NULL,          -- 0-100 (rescaled)
  score_raw float NOT NULL,               -- raw cosine similarity for calibration
  scores_by_theme jsonb NOT NULL,         -- [{ theme: string, score: number, score_raw: float, chunk_count: number }]
  theme_count integer NOT NULL,
  chunk_count integer NOT NULL,           -- total reference chunks used
  low_confidence boolean DEFAULT false,   -- true if single cluster
  calculated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_fidelity_persona ON fidelity_scores(persona_id, calculated_at DESC);
```

Stores both rescaled (display) and raw (calibration) scores to tune RAW_MIN/RAW_MAX later.

### API (`api/fidelity.js`)

**GET /api/fidelity?persona={id}**

Authorization: requires valid session + persona ownership (same check as other persona endpoints).

Returns latest score + last 10 scores for trend.

```json
{
  "current": {
    "score_global": 74,
    "scores_by_theme": [
      { "theme": "Stratégie produit", "score": 82, "chunk_count": 5 },
      { "theme": "Leadership & culture", "score": 71, "chunk_count": 3 },
      { "theme": "Growth & acquisition", "score": 68, "chunk_count": 4 }
    ],
    "low_confidence": false,
    "calculated_at": "2026-04-16T20:00:00Z"
  },
  "history": [
    { "score_global": 62, "calculated_at": "2026-04-09T..." },
    { "score_global": 68, "calculated_at": "2026-04-12T..." },
    { "score_global": 74, "calculated_at": "2026-04-16T..." }
  ],
  "chunk_count": 12,
  "can_calculate": true
}
```

**GET /api/fidelity?personas={id1,id2,id3}** (batch)

Returns `{ scores: { [personaId]: { score_global, calculated_at } } }`. Used by the hub page to avoid N+1 requests.

**POST /api/fidelity**

Body: `{ personaId }`

Authorization: requires valid session + persona ownership.
Rate-limited: max 1 recalculation per persona per hour (check `calculated_at` of latest score).
Returns the new score object.

### Recalculation Triggers

| Trigger | Mechanism |
|---------|-----------|
| After correction consolidation | `correction-consolidation.js` calls fidelity recalc at end of pipeline, wrapped in try/catch (fire-and-forget — fidelity failure must never break consolidation) |
| Manual from IntelligencePanel | User clicks "Recalculer" button → POST /api/fidelity |
| First visit after 7+ days | Hub page checks `calculated_at` from batch response, if stale fires background POST, shows previous score with "(recalcul en cours...)" badge until complete |

### Cost Per Calculation

| Step | Cost |
|------|------|
| Retrieve chunks | Free (DB read) |
| Clustering | Free (CPU, ~10ms) |
| Theme labeling | ~$0.001 (1 Haiku call) |
| Generate clone texts | ~$0.005 per theme x ~4 themes = ~$0.02 (Sonnet) |
| Embed generated texts | ~$0.0005 per theme (Voyage) |
| **Total** | **~$0.025 per recalculation** |

At ~2 recalculations/week per persona, this is ~$0.20/month/persona. Negligible.

## UI Design

### 1. Hub Page (`+page.svelte`) — Score Gauge on Clone Cards

The hub page renders clone cards inline (`.clone-card` / `.clone-header` classes, not via PersonaCard component). Add an SVG arc gauge to the right side of each `.clone-header`.

```
┌─────────────────────────────────┐
│  🧑  Paolo Rossi          ╭──╮ │
│  Growth Strategist         │74│ │
│                            ╰──╯ │
│  [Conversation] [Post]          │
└─────────────────────────────────┘
```

**Implementation:**
- SVG arc (semicircle, 36px diameter), stroke-dasharray for progress
- Color: `--accent` at varying opacity — red (<50) → amber (50-75) → green (>75)
- Score number centered inside arc, bold, 14px
- If `score === null`: show "—" with tooltip "Pas assez de posts"
- If recalculating: show small spinner replacing the number
- Subtle pulse animation when score increases vs. previous

**Data flow:** Hub page fetches `GET /api/fidelity?personas={all_ids}` once on mount (batch endpoint). No N+1 problem. Score cached in component state, refreshed on navigation back to hub.

### 2. IntelligencePanel — Fidelity Section

New section at the TOP of IntelligencePanel, above corrections. This is the headline metric.

```
┌──────────────────────────────────────┐
│  FIDELITE VOCALE                 74  │
│  ████████████████░░░░░░    +12 pts   │
│                                      │
│  Strategie produit         ████ 82   │
│  Leadership & culture      ███░ 71   │
│  Growth & acquisition      ███░ 68   │
│                                      │
│  Base sur 12 posts · Calcule il y    │
│  a 2h · [Recalculer]                 │
│                                      │
│  ┌─ Tendance (30j) ──────────────┐   │
│  │    ╱──╲    ╱──                │   │
│  │  ╱      ╲╱      score        │   │
│  │ 62  68  71  74                │   │
│  └───────────────────────────────┘   │
├──────────────────────────────────────┤
│  CORRECTIONS (47)                    │
│  ...                                 │
```

**Components:**
- **Global score**: Large number (32px) + horizontal progress bar + delta vs. previous ("+12 pts" in green)
- **Per-theme breakdown**: List of themes with mini progress bars + score number
- **Metadata line**: Chunk count, recalc time (relative), manual recalc button (disabled if <1h since last)
- **Trend sparkline**: SVG polyline showing last 10 scores. Minimal — no axes, just line + score labels at first/last points. Uses `history` from API.
- **States**: loading (skeleton), no data (message + explanation), low confidence (amber badge)

**Color scheme:**
- Bars use `--accent` at varying opacity
- Delta badge: `--success` for positive, `--warning` for flat (+/-2), `--error` for negative
- Sparkline: thin line in `--accent`, small dots at each data point

### 3. Admin Dashboard

Add fidelity to the personas grid in `admin/+page.svelte`:

```
┌─────────────────────────┐
│  🧑 Paolo               │
│  Client: Agence XYZ     │
│  💬 12  ✏️ 47  🧠 23    │
│  Fidelite: 74 (+12)     │
└─────────────────────────┘
```

Single line addition. Score fetched via existing `/api/usage?view=personas` endpoint — add a lateral join to `fidelity_scores` (latest per persona).

## File Changes Summary

| File | Change |
|------|--------|
| **new** `lib/fidelity.js` | Score calculation pipeline + cosineSim (moved from consolidation) (~140 lines) |
| **new** `api/fidelity.js` | GET (single + batch) + POST endpoints with auth + rate limit (~90 lines) |
| **new** `supabase/015_fidelity_scores.sql` | Table + index (~15 lines) |
| **mod** `lib/correction-consolidation.js` | Import cosineSim from fidelity.js instead of local, add try/catch fidelity recalc trigger (~5 lines) |
| **mod** `src/lib/components/IntelligencePanel.svelte` | New fidelity section at top (~110 lines) |
| **mod** `src/routes/+page.svelte` | Batch fetch fidelity scores, render SVG gauge in clone-header (~50 lines) |
| **mod** `src/routes/admin/+page.svelte` | Show fidelity in persona grid (~5 lines) |
| **mod** `api/usage.js` | Lateral join fidelity_scores in personas view (~5 lines) |

**Total:** ~400 lines new code, ~20 lines modified.

## What This Design Does NOT Include

- Fine-tuning or model training (unnecessary)
- LLM-based quality judging (expensive, non-deterministic)
- Real-time scoring during chat (too expensive, no user value)
- Style transfer metrics beyond embedding similarity (YAGNI)
- A/B comparison UI (future iteration if needed)
- Per-post re-embedding (v1 works with existing chunks; revisit if score noise is too high)

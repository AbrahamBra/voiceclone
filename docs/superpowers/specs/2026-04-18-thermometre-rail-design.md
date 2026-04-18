# Thermomètre Rail — Design Spec

**Date:** 2026-04-18
**Status:** Draft
**Files:**
- new `lib/heat/narrativeSignals.js` — rule-based narrative signal generator
- new `api/heat.js` — fetch current heat + signals for a conversation
- new `src/lib/components/HeatThermometer.svelte` — rail gauge + journal
- modified `src/routes/chat/[persona]/+page.svelte` — right column becomes `HeatThermometer` instead of per-message marginalia
- modified `src/lib/components/ChatMessage.svelte` — per-message marginalia moves behind a toggle below each bot message

## Problem

Le cockpit de chat actuel a une marge droite dense (`MessageMarginalia`) qui affiche par bot message la fidélité, règles violées, style fingerprint, timing, tokens. C'est de l'observabilité labo utile pour entraîner un clone, mais en usage "vente" c'est du bruit : l'espace de droite est majoritairement vide (pas d'annotations tant que le clone n'a pas produit), et quand il y en a c'est illisible pour qui cherche à vendre.

En parallèle, le backend calcule depuis la wave RhythmCritic une *prospect heat* (score business ∈ [0,1] par message prospect, avec delta et signaux) qui n'est **jamais affichée** — elle vit en shadow mode dans la table `prospect_heat`.

L'utilisateur (vendeur) ne sait pas visuellement si sa conversation se réchauffe ou refroidit, et n'a pas de repère pour décider quand proposer un RDV.

## Solution : rail instrument + journal narratif

Une colonne de droite unique par conversation, qui affiche :

1. Un **rail vertical d'encre** (instrument de mesure, pas thermomètre-cartoon) indiquant la heat actuelle ∈ [0,1]
2. Un **score mono 40px**, un **état** coloré par zone (froid bleu / tiède ocre / chaud vermillon) avec direction (montant/descendant/stable), un **Δ** sur le dernier message
3. Un **journal narratif** des derniers signaux : chaque ligne = une phrase courte ancrée dans une citation du texte, avec delta (± numérique, vert/vermillon)

La heat peut **descendre** (ghost, relances sans réponse) comme monter.

Pas de sparkline de trajet, pas de suggestion d'action (le clone suggère déjà).

La marginalia par-message (fidélité, règles, style) est déplacée : collapsable sous chaque bot message via un toggle, pas dans la marge de droite.

### Pourquoi ce design

| Décision | Raison |
|----------|--------|
| Rail d'encre (pas bulbe thermomètre cartoon) | Cohérence avec l'esthétique labo/observatoire paper-ink-vermillon du reste de l'app |
| Un seul signal heat agrégé par conversation (pas par message) | Le vendeur veut "où on en est maintenant", pas un historique détaillé |
| Signaux narratifs avec citations (pas ratios numériques) | Calibrage sur vraies convs (Olga/Edwige 2 msgs vs Daniel 87 jours) a montré que les métriques mécaniques ("20 mots", "ratio questions") ne survivent pas à la variance |
| Pas de funnel figé (accroche → découverte → pont → CTA) | Certains prospects skip toutes les étapes (Edwige demande la visio au msg 2) ; un funnel rigide force à chaque persona alors qu'ils ont des patterns différents |
| Pas de sparkline | "Ça apporte rien" (feedback utilisateur 2026-04-18) |
| Pas de suggestion d'action | Double emploi avec le clone qui suggère déjà les messages |
| Heat peut descendre | Une conv peut se refroidir (ghost, relance sans réponse, hostilité) |
| Marginalia labo → behind a toggle | Préserve l'observabilité pour qui veut entraîner, sans polluer la vue vendeur |

## Architecture

### Data flow

```
Chat page mounts for conversation X
  → GET /api/heat?conversation_id=X
    → fetch latest prospect_heat row (current heat + delta + signals JSONB)
    → fetch last N messages (for narrative signal extraction)
    → run narrativeSignals.extract(messages, prospect_heat_rows)
      → returns [{ kind, label, quote, delta, when, polarity }]
    → return { current: { heat, delta, state, direction }, signals: [...] }
  → HeatThermometer renders rail + journal

On each new prospect message (existing flow):
  logProspectHeat writes new row to prospect_heat
  → SSE "heat" event on the chat stream
  → HeatThermometer re-fetches (or receives via SSE payload)
  → rail-fill height + score + state animate in

On each new clone message:
  → No heat write (heat is prospect-driven)
  → But narrativeSignals may emit an outgoing-derived signal
    (e.g., "3e relance sans réponse — -0.05") on next /api/heat call
```

### Narrative signal extraction

`lib/heat/narrativeSignals.js` — pure function, no IO.

**Signature:**

```js
/**
 * @param {object} input
 * @param {Array<{id: string, role: "bot"|"user", content: string, created_at: string|Date}>} input.messages
 *   Ordered by created_at ASC. Includes both bot (outbound) and user (prospect) rows.
 * @param {Array<{message_id: string, heat: number, delta: number|null, signals: object, created_at: string|Date}>} input.heatRows
 *   All prospect_heat rows for this conversation, ordered by created_at ASC.
 * @param {Date} [input.now=new Date()]
 *   Reference "now" used by outbound-only detectors (ghost, relance).
 * @param {number} [input.limit=8]
 *   Max signals returned (newest-first, after capture of all candidates).
 *
 * @returns {{
 *   signals: Array<NarrativeSignal>,
 *   total: number
 * }}
 *
 * @typedef NarrativeSignal
 * @property {string} kind                     // one of the rule keys below
 * @property {string} label                    // short FR string, shown in strong
 * @property {string} quote                    // citation snippet, max 120 chars
 * @property {"pos"|"neg"} polarity
 * @property {number} delta                    // absolute value used in display
 * @property {string} when                     // ISO timestamp of the triggering message
 * @property {string|null} message_id          // triggering message (null for ghost/relance spans)
 */
```

`total` is the full count of signals extracted from the whole conversation (not the limited `signals` array) — used by the header "{total} signaux" display.

**Pattern-based rules, v1 (rules-only, no LLM):**

| Kind | Detection | Label | Quote source |
|------|-----------|-------|--------------|
| `accept_call` | prospect message contains accept-keyword (`oui`, `carrément`, `yes`, `ok`, `avec plaisir`) AND preceding clone msg contains call-keyword (`call`, `visio`, `appel`, `rdv`, `discuter`) | "Accepte le call" | prospect msg snippet |
| `propose_call` | prospect message initiates call (`on peut en discuter de vive voix`, `on bloque une visio`, `booker un call`, `je suis disponible`) | "Propose le call elle-même" | prospect msg snippet |
| `gives_email` | prospect message matches email regex | "Donne son email" | matched email (masked) |
| `books_slot` | prospect message confirms slot (`j'ai booké`, `c'est fait`, date + heure pattern) | "Confirme un créneau" | prospect msg snippet |
| `business_context` | prospect message word count ≥ 80 (same measure as `normLength` in `prospectHeat.js` — `(content.match(/\S+/g) \|\| []).length`) AND contains business terms (`client`, `équipe`, `biz`, `marché`, `portfolio`, role titles) | "Détaille son contexte" | first sentence up to 120 chars |
| `positive_interest` | prospect lexical_score ≥ 0.75 AND no other rule triggered | "Verbalise intérêt" | matched positive word's sentence |
| `question_back` | prospect message ends with "?" AND contains curiosity markers (`comment`, `pourquoi`, `tu peux m'en dire plus`) | "Pose une question en retour" | the question |
| `ghost_2days` | last outbound from clone, no inbound for ≥48h | "2+ jours de silence" | nombre de jours |
| `relance_unanswered` | ≥2 consecutive outbound without inbound between | "N relances sans réponse" | period length |
| `cold_lexical` | prospect message with lexical_neg match (`pas le temps`, `plus tard`, `pas intéressé`) | "Verbalise refus/report" | matched phrase |

Each signal carries a polarity (`pos` / `neg`), a delta magnitude derived from the heat row's `delta` field (or from our own heuristic for outbound-only signals like ghost), and a `when` timestamp.

**Quote truncation rule:** max 120 characters. If the natural source (first sentence, matched phrase, etc.) exceeds 120, truncate at the last word boundary before 120 and append `…`.

**Conflict resolution (multiple rules matching one prospect message):** detect all matches — do not dedupe. For display ordering inside a single triggering message, sort by priority (higher first):

```
books_slot > accept_call > propose_call > gives_email >
positive_interest > question_back > business_context >
cold_lexical > relance_unanswered > ghost_2days
```

This affects display order inside the 8-signal window only; detection keeps all matches.

**Outbound-only signals (`ghost_2days`, `relance_unanswered`):** computed on-demand each time `/api/heat` is called, using `now` vs. the timestamp of the last outbound message. No cron, no periodic job. Consequence: a ghosted conversation's thermometer shows the ghost signal the next time the vendor opens the chat page for that conversation — which is the moment it matters. Deltas for these signals are synthetic (`−0.08` for 48h ghost, `−0.05` per additional unanswered relance, capped at `−0.15`), displayed only, never written to `prospect_heat`.

**Signal heat contribution:** signals don't compute heat; they *explain* heat. Heat comes from `prospect_heat.heat`. The signal generator reads existing rows and annotates them.

**Historical conversations:** on first `/api/heat` call for an existing conversation, signals are extracted from whatever `prospect_heat` rows + `messages` rows already exist. No backfill job is needed — the extraction is stateless and runs per request.

**Future (v2):** one LLM call per new prospect message to generate a qualitative label for subtle signals the rules miss. Not in v1 scope.

### Aggregated heat

Current heat = `heat` from the most recent `prospect_heat` row for the conversation.
Delta = `delta` from same row.
State (zone) derived:

```
0.00–0.25 → "glacé"
0.25–0.45 → "froid"
0.45–0.65 → "tiède"
0.65–0.85 → "chaud"
0.85–1.00 → "brûlant"
```

Direction derived from `delta`:

```
delta > +0.03 → "montant"
delta < -0.03 → "descendant"
else → "stable"
```

Label displayed: `{zone}, {direction}` — e.g. "tiède, montant".

Color of label (uses existing design-system tokens only, no new CSS vars):
- `glacé` / `froid` → `var(--ink-40)` (subdued grey — reads "dormant")
- `tiède` → `var(--warning)` (existing `#b87300` ochre)
- `chaud` / `brûlant` → `var(--vermillon)`

Delta color:
- positive → `var(--success)`
- negative → `var(--vermillon)`

If no `prospect_heat` rows yet (new conv, no prospect msg): display neutral state (score `—`, label "en attente", no color, rail empty).

**Important:** the numeric `heat` value only changes when a new prospect message arrives (via `logProspectHeat`). Outbound-only signals (`ghost_2days`, `relance_unanswered`) do NOT move the rail — their synthetic deltas are journal-only. The rail may therefore stay at the last computed heat even while the journal shows cooling signals. This is intentional: heat is a prospect-side measurement, not a vendor-side one.

### API: `/api/heat`

```
GET /api/heat?conversation_id=<uuid>
Headers: Authorization: Bearer <accessCode>
```

Response:
```json
{
  "current": {
    "heat": 0.58,
    "delta": 0.22,
    "state": "tiède",
    "direction": "montant"
  },
  "signals": [
    {
      "kind": "accept_call",
      "label": "Accepte le call",
      "quote": "Yes pas de soucis.",
      "polarity": "pos",
      "delta": 0.22,
      "when": "2026-02-11T09:10:00Z",
      "message_id": "uuid…"
    },
    ...up to 8 most-recent signals...
  ],
  "total_signals": 24
}
```

`signals` is limited to the 8 newest. `total_signals` is the full count of signals extracted from the whole conversation (= `narrativeSignals.extract(...).total`). The header displays "{total} signaux" and the body shows the 8 newest.

Cache: none (stateless per-call regeneration). Chat-page traffic is low (a single user at a time) so the cost is acceptable. Revisit if `/api/heat` load becomes a concern.

Errors:
- `404` if conversation not found / user has no access.
- `200` with `current: { heat: null, delta: null, state: null, direction: null }` and `signals: []`, `total_signals: 0` if conv exists but has no prospect messages yet.
- Existing conversation with prospect messages but no `prospect_heat` rows (shouldn't happen — `logProspectHeat` writes on every prospect message — but defensive): return `200` with the same empty shape.

### SSE integration

Extend the existing `/api/chat` SSE stream: after `logProspectHeat` writes a new row, the server runs `narrativeSignals.extract` on the updated conversation state and emits a `heat` event on the SSE stream. The payload IS the same shape as the `/api/heat` GET response:

```json
{
  "current": { "heat": 0.58, "delta": 0.22, "state": "tiède", "direction": "montant" },
  "new_signal": {
    "kind": "accept_call",
    "label": "Accepte le call",
    "quote": "Yes pas de soucis.",
    "polarity": "pos",
    "delta": 0.22,
    "when": "2026-02-11T09:10:00Z",
    "message_id": "uuid…"
  },
  "total_signals": 25
}
```

**Authority model:** the SSE event is authoritative. `HeatThermometer` updates its local state from the SSE payload in place — it does NOT re-fetch `/api/heat` after receiving a `heat` event. The component only calls `/api/heat` (GET) on mount and when `conversationId` changes.

`new_signal` is nullable — fired when the latest prospect message triggered at least one rule. If present, the client prepends it to the local `signals` array (capped at 8). If null, only `current` + `total_signals` are updated.

### Component: `HeatThermometer.svelte`

Props:
```svelte
let {
  conversationId,  // required, changes when user switches conv
} = $props();
```

State:
```svelte
let heat = $state(null);        // { heat, delta, state, direction } | null
let signals = $state([]);        // narrative signal objects, newest first
let totalSignals = $state(0);
let loading = $state(true);
```

Lifecycle:
- On mount / when `conversationId` changes: fetch `/api/heat?conversation_id=...`
- Subscribe to `heat` SSE events: update in place
- On unmount: unsubscribe

Render:
- `therm-head`: title "Thermomètre" + count "{total} signaux"
- `rail-wrap`: rail (grid 3px d'encre on `--ink-10`, filled with `--ink` from 0 to `heat * 100%`, with a 1px horizontal line at current position) + data column (score mono 40px, state italic 16px colored by zone, delta mono 10.5px green/vermillon)
- `signals-block`: `signals-title` + up to 8 `.sig` entries (strong label + quote in italic below + when/delta column on right)

Empty state (`loading && !heat`): skeleton lines. No data state (`!loading && !heat`): rail empty, score "—", label "en attente du premier message prospect" in `--ink-40`.

### Placement in chat page

Current `src/routes/chat/[persona]/+page.svelte`:
- `.chat-layout` = sidebar + `.chat-main` (cockpit + messages + input + AuditStrip)
- `ChatMessage` renders `MessageMarginalia` inline as right-column sibling per message

New layout:
```
.chat-layout
  ConversationSidebar
  .chat-main
    ChatCockpit
    .chat-body  ← new wrapper, 2-column
      .chat-messages (existing, now in left column)
      HeatThermometer (right column, sticky, width 300px, full height)
    ChatInput
    AuditStrip
```

`ChatMessage` stops rendering `MessageMarginalia` in the right column. Instead, a small `⋯` button at the bottom-right of each bot message toggles an inline collapsable `MessageMarginalia` block **below** the message text (not to the right).

**Toggle behavior:**
- State is per-message, stored in local component state (`$state` on each `ChatMessage`). Not persisted across page reloads — each reload starts with all toggles closed.
- Button is a `<button>` element, focusable via keyboard, activated by Enter/Space (native behavior).
- `aria-expanded` reflects open/closed state; `aria-controls` points to the marginalia block's `id`.
- The existing grid layout in `ChatMessage.svelte` (two columns: message + marginalia) collapses to a single column; marginalia becomes a child of the message column, rendered below the text content when expanded.

### Mobile (≤ 768px)

Thermometer collapses to a compact horizontal bar **above** `ChatInput` (not a top fixed status bar — the chat header is already busy):

- One line: score (18px mono) · state label (13px italic, colored) · delta (11px mono)
- Tappable: opens a bottom-sheet modal with the full journal (signals list, same shape as desktop)
- The rail itself is hidden on mobile — only text data. The gauge metaphor isn't adding value on narrow width.

## Non-goals

- **No manager dashboard view** in this spec. If a manager needs cross-conversation heat summaries later, build it separately.
- **No LLM-based signal generation** in v1. Pattern rules only. LLM can come in v2 if rules miss meaningful signals.
- **No automatic CTA** (e.g., a button that auto-sends a calendar link when heat hits 0.8). User triggers actions themselves; the thermometer *informs*, doesn't *act*.
- **No heat trajectory/sparkline** — explicitly rejected as low value by user feedback.
- **No prediction / ETA to RDV.** Current heat is backward-looking only.
- **No backfill of historical conversations' signals** at launch. Signals appear for new conversations and for the most recent heat rows of existing conversations.

## Open questions

1. **Threshold tuning.** Zone boundaries (0.25/0.45/0.65/0.85) are initial guesses. After a few weeks we should calibrate on real data: distribution of heat values where RDVs actually got booked. Not a launch blocker — tune post-launch.

2. **Relance / ghost display persistence.** Do ghost signals stay in the journal once the prospect re-engages, or disappear? Proposed default: stay (the cold patch is part of the story), rendered with reduced opacity once a more recent positive signal exists. Revisit after launch based on feel.

## Implementation phases

### Phase 1 — read-only plumbing (1 PR)
- `lib/heat/narrativeSignals.js` (pure function, unit-tested on real conv fixtures: Cecilia/Thomas, Edwige/Adrien, Daniel/Thierry, etc.)
- `api/heat.js` endpoint
- Unit tests on narrative extraction against fixture conversations (stored as JSON under `test/fixtures/heat-conversations/`)

### Phase 2 — UI component (1 PR)
- `HeatThermometer.svelte` with all visual states (loading, empty, tiède/froid/chaud, positive/negative signals)
- Storybook-style route at `/labo/heat` showing the component with fixture data for visual review

### Phase 3 — chat page integration (1 PR)
- Rewire `src/routes/chat/[persona]/+page.svelte` layout
- Move per-message marginalia to inline toggle under bot messages
- SSE `heat` event wiring from `/api/chat`
- Mobile layout

## Testing

- **Unit:** `narrativeSignals.extract` against named fixtures (see below). Each fixture conv produces an expected signal sequence that is snapshotted and compared on every test run.
- **Integration:** `/api/heat` returns correct shape and handles empty conversations.
- **Visual:** `/labo/heat` route with 3 fixture states (empty, mid-tiède, chaud-montant) for eyeball review at desktop + mobile sizes.
- **Regression:** existing `MessageMarginalia` content-rendering tests stay passing (the component's internal rendering doesn't change). Tests that assert on the parent grid layout or on the marginalia's *position* within `ChatMessage` (right column) WILL need updates — the marginalia moves from a right-column sibling to a below-message child. Flag these at implementation time.

### Fixtures (closed set for Phase 1)

Stored as JSON under `test/fixtures/heat-conversations/`:

| Fixture | Persona | Pattern | Expected signals highlight |
|---------|---------|---------|----------------------------|
| `cecilia-bluecoders.json` | Thomas | 4 msgs → prospect proposes call | `propose_call` |
| `edwige-maveilleia.json` | Adrien | 2 msgs → prospect asks to book | `propose_call`, `books_slot` |
| `olga-maveilleia.json` | Adrien | Adrien proposes → prospect accepts + gives slot + email | `accept_call`, `books_slot`, `gives_email` |
| `nathalie-maveilleia.json` | Adrien | Discovery on tools (GetMint) → slot confirm | `business_context`, `books_slot`, `gives_email` |
| `theotime-maveilleia.json` | Adrien | Delayed (silence) → late reply → RDV | `ghost_2days`, `relance_unanswered`, `accept_call` |
| `daniel-immostates.json` | Thierry | 87 days, 6 relances, ghost+revival, finally books | `relance_unanswered` (multiple), `positive_interest`, `business_context`, `books_slot` |
| `hassan-immostates.json` | Thierry | Discovery dance on fractional vs crowdfunding → call | `question_back`, `accept_call` |
| `pierre-immostates.json` | Thierry | 1 Thierry msg → prospect already interested | `propose_call` |
| `cold-refusal.json` | synthetic | Prospect says "pas le temps" | `cold_lexical`, heat descent |
| `empty.json` | any | New conv, no prospect msg yet | no signals, empty state |

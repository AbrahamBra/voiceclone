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

`lib/heat/narrativeSignals.js` — pure function, no IO. Input: ordered array of messages (role, content, created_at) + array of prospect_heat rows. Output: array of narrative signal objects.

**Pattern-based rules, v1 (rules-only, no LLM):**

| Kind | Detection | Label | Quote source |
|------|-----------|-------|--------------|
| `accept_call` | prospect message contains accept-keyword (`oui`, `carrément`, `yes`, `ok`, `avec plaisir`) AND preceding clone msg contains call-keyword (`call`, `visio`, `appel`, `rdv`, `discuter`) | "Accepte le call" | prospect msg snippet |
| `propose_call` | prospect message initiates call (`on peut en discuter de vive voix`, `on bloque une visio`, `booker un call`, `je suis disponible`) | "Propose le call elle-même" | prospect msg snippet |
| `gives_email` | prospect message matches email regex | "Donne son email" | matched email (masked) |
| `books_slot` | prospect message confirms slot (`j'ai booké`, `c'est fait`, date + heure pattern) | "Confirme un créneau" | prospect msg snippet |
| `business_context` | prospect message ≥80 words AND contains business terms (`client`, `équipe`, `biz`, `marché`, `portfolio`, roles) | "Détaille son contexte" | first 80 chars |
| `positive_interest` | prospect lexical_score ≥ 0.75 AND no other rule triggered | "Verbalise intérêt" | matched positive word's sentence |
| `question_back` | prospect message ends with "?" AND contains curiosity markers (`comment`, `pourquoi`, `tu peux m'en dire plus`) | "Pose une question en retour" | the question |
| `ghost_2days` | last outbound from clone, no inbound for ≥48h | "2+ jours de silence" | nombre de jours |
| `relance_unanswered` | ≥2 consecutive outbound without inbound between | "N relances sans réponse" | period length |
| `cold_lexical` | prospect message with lexical_neg match (`pas le temps`, `plus tard`, `pas intéressé`) | "Verbalise refus/report" | matched phrase |

Each signal carries a polarity (`pos` / `neg`), a delta magnitude derived from the heat row's `delta` field (or from our own heuristic for outbound-only signals like ghost), and a `when` timestamp.

**Signal heat contribution:** signals don't compute heat; they *explain* heat. Heat comes from `prospect_heat.heat`. The signal generator reads existing rows and annotates them. For outbound-only signals (ghost, relance), the signal generator assigns a small synthetic delta (−0.05 to −0.15) that is **displayed only** (not persisted) — it represents "the vendor's attention cost" not a backend-scored change.

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

Color of label:
- `glacé` / `froid` → `var(--cold)`
- `tiède` → `var(--warm)`
- `chaud` / `brûlant` → `var(--vermillon)`

If no `prospect_heat` rows yet (new conv, no prospect msg): display neutral state (score `—`, label "en attente", no color, rail empty).

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
    ...up to 8 recent signals...
  ],
  "total_signals": 24
}
```

Cache: none (fresh every call — heat changes rarely enough that caching isn't critical, and staleness hurts the "live" feel).

Errors: 404 if conversation not found / user has no access. 200 with empty `current` + `signals:[]` if conv exists but has no prospect messages yet.

### SSE integration

Extend the existing `/api/chat` SSE stream: after `logProspectHeat` writes a new row, emit a `heat` event with the new `{ heat, delta, state, direction, new_signal? }` payload. `HeatThermometer` subscribes and updates in-place without re-fetching.

This keeps the thermometer reactive during a live conversation without polling.

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

### Mobile (≤ 768px)

Thermometer collapses to a compact horizontal header above `ChatInput`:
- Score + state + delta on one line
- Signals accessible via tap-to-expand (shows a modal or bottom sheet with the journal)

Alternatively, the thermometer sits at the top of the page (fixed), like a status bar. TBD — pick at implementation time.

## Non-goals

- **No manager dashboard view** in this spec. If a manager needs cross-conversation heat summaries later, build it separately.
- **No LLM-based signal generation** in v1. Pattern rules only. LLM can come in v2 if rules miss meaningful signals.
- **No automatic CTA** (e.g., a button that auto-sends a calendar link when heat hits 0.8). User triggers actions themselves; the thermometer *informs*, doesn't *act*.
- **No heat trajectory/sparkline** — explicitly rejected as low value by user feedback.
- **No prediction / ETA to RDV.** Current heat is backward-looking only.
- **No backfill of historical conversations' signals** at launch. Signals appear for new conversations and for the most recent heat rows of existing conversations.

## Open questions

1. **Mobile placement** — collapsed horizontal bar above input, or fixed top status bar, or tap-to-reveal modal? Implementation time decision.

2. **When to regenerate signals.** Every `/api/heat` call? Cached in a table `conversation_signals` and invalidated on new message? Cost/benefit: regen-per-call is simpler but scales linearly with chat page views. A tiny cache keyed by (conversation_id, last_message_id) covers 90% of the cost.

3. **Threshold tuning.** Zone boundaries (0.25/0.45/0.65/0.85) are initial guesses. After a few weeks we should calibrate on real data: distribution of heat values where RDVs actually got booked.

4. **Signal polarity conflicts.** If a single message triggers multiple rules (e.g., prospect says "yes let's book, here's my email"), do we emit one merged signal or N separate ones? Proposed: N separate, prioritized by kind (accept_call > gives_email > positive_interest).

5. **Relance / ghost display persistence.** Do ghost signals stay in the journal once the prospect re-engages, or disappear? Proposed: stay (the cold patch is part of the story), but greyed out.

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

- **Unit:** narrativeSignals.js against fixtures — each fixture conv produces expected signal sequence.
- **Integration:** `/api/heat` returns correct shape and handles empty conversations.
- **Visual:** `/labo/heat` route with 3 fixture states (empty, mid-tiède, chaud-montant) for eyeball review at desktop + mobile sizes.
- **Regression:** existing MessageMarginalia tests stay passing (it's just moved, not deleted).

# Thermomètre Rail — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chat-page right column (currently per-bot-message `MessageMarginalia` with fidelity/rules/style) with a `HeatThermometer` — a rail-instrument gauge showing prospect heat ∈ [0,1], state label, delta, and a journal of narrative signals extracted from the conversation.

**Architecture:**
- **Backend** exposes conversation-level heat data: a new `lib/heat/narrativeSignals.js` pure function extracts narrative signals (accept_call, ghost, gives_email, …) from existing `prospect_heat` rows + `messages`; `api/heat.js` GET endpoint returns `{ current, signals, total_signals }`; `api/chat.js` emits an SSE `heat` event after every `logProspectHeat` write.
- **Frontend** renders a new `src/lib/components/HeatThermometer.svelte` that fetches once on mount and updates in-place from SSE events thereafter. The old `MessageMarginalia` moves from right-column sibling to a toggleable block below each bot message.
- **Mobile** (≤768px) collapses the thermometer to a compact horizontal bar above `ChatInput` with tap-to-expand signals.

**Tech Stack:** Node `node:test` + `node:assert/strict` (backend unit tests); Svelte 5 runes (`$state`, `$props`, `$derived`, `$effect`); Vercel serverless functions; Supabase for `prospect_heat` + `messages`; SSE via existing `lib/sse.js` helper.

**Spec:** `docs/superpowers/specs/2026-04-18-thermometre-rail-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| **new** `lib/heat/narrativeSignals.js` | Pure extractor: `({messages, heatRows, now, limit}) → {signals, total}` |
| **new** `test/narrative-signals.test.js` | Unit tests per signal kind + against real conversation fixtures |
| **new** `test/fixtures/heat-conversations/*.json` | 10 real conversation fixtures with expected signal sequences |
| **new** `api/heat.js` | GET `/api/heat?conversation_id=…` — returns `{current, signals, total_signals}` |
| **new** `src/lib/components/HeatThermometer.svelte` | Rail gauge + score + state + delta + signals journal; desktop + mobile |
| **new** `src/routes/labo/heat/+page.svelte` | Visual test route rendering `HeatThermometer` with fixture states |
| **mod** `api/chat.js` | Await `logProspectHeat` result + emit `sse("heat", …)` before `res.end()` |
| **mod** `src/lib/sse.js` | Add `heat` case to SSE event switch; expose `onHeat` callback |
| **mod** `src/routes/chat/[persona]/+page.svelte` | New 2-column `.chat-body` layout; `HeatThermometer` in right column; `onHeat` wired to `streamChat` |
| **mod** `src/lib/components/ChatMessage.svelte` | Stop rendering `MessageMarginalia` to the right; render below via toggle button |
| **mod** `src/lib/components/MessageMarginalia.svelte` | Adapt CSS for below-message orientation (replaces the existing `@media (max-width: 1024px)` horizontal rail-style fallback as the default) |

---

## Chunk 1: Fixture format + extractor scaffold + first detector

### Task 1: Create fixture directory + smoke fixture

**Files:**
- Create: `test/fixtures/heat-conversations/empty.json`
- Create: `test/fixtures/heat-conversations/cold-refusal.json`

- [ ] **Step 1: Create the fixture schema as `empty.json`**

This fixture represents a fresh conversation with no prospect messages (just welcome/bot greeting). It's the baseline for the `no prospect_heat rows` code path.

```json
{
  "name": "empty",
  "description": "New conversation, only welcome bot message",
  "now": "2026-04-18T10:00:00Z",
  "messages": [
    {
      "id": "m1",
      "role": "bot",
      "content": "Salut ! Sur quoi tu veux bosser ?",
      "created_at": "2026-04-18T10:00:00Z"
    }
  ],
  "heatRows": [],
  "expected": {
    "total": 0,
    "signals": [],
    "current": { "heat": null, "delta": null, "state": null, "direction": null }
  }
}
```

- [ ] **Step 2: Create `cold-refusal.json` synthetic fixture**

```json
{
  "name": "cold-refusal",
  "description": "Prospect explicitly declines — cold_lexical signal + heat descent",
  "now": "2026-04-18T12:00:00Z",
  "messages": [
    { "id": "m1", "role": "bot", "content": "Salut Marc, comment tu vas ? L'immo fractionné ça te parle ?", "created_at": "2026-04-18T11:00:00Z" },
    { "id": "m2", "role": "user", "content": "Pas le temps pour ça, plus tard peut-être.", "created_at": "2026-04-18T11:05:00Z" }
  ],
  "heatRows": [
    {
      "message_id": "m2",
      "heat": 0.18,
      "delta": -0.32,
      "signals": { "len_norm": 0.14, "question_ratio": 0, "recency": 1.0, "lexical": 0.0, "trend": 0.5 },
      "created_at": "2026-04-18T11:05:00Z"
    }
  ],
  "expected": {
    "total": 1,
    "signals": [
      { "kind": "cold_lexical", "polarity": "neg", "quote_contains": "pas le temps" }
    ],
    "current": { "heat": 0.18, "delta": -0.32, "state": "glacé", "direction": "descendant" }
  }
}
```

- [ ] **Step 3: Verify fixtures parse as JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('test/fixtures/heat-conversations/empty.json', 'utf8')); JSON.parse(require('fs').readFileSync('test/fixtures/heat-conversations/cold-refusal.json', 'utf8')); console.log('OK')"`

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add test/fixtures/heat-conversations/empty.json test/fixtures/heat-conversations/cold-refusal.json
git commit -m "test(heat): seed fixture conversations — empty + cold-refusal"
```

---

### Task 2: Scaffold `narrativeSignals.js` + empty-case test

**Files:**
- Create: `lib/heat/narrativeSignals.js`
- Create: `test/narrative-signals.test.js`

- [ ] **Step 1: Write the failing test for empty input**

Create `test/narrative-signals.test.js`:

```js
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { extract } from "../lib/heat/narrativeSignals.js";

function loadFixture(name) {
  return JSON.parse(readFileSync(`test/fixtures/heat-conversations/${name}.json`, "utf8"));
}

describe("narrativeSignals.extract", () => {
  it("returns empty result for empty fixture", () => {
    const fx = loadFixture("empty");
    const result = extract({
      messages: fx.messages,
      heatRows: fx.heatRows,
      now: new Date(fx.now),
    });
    assert.deepEqual(result, { signals: [], total: 0 });
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npm test -- --test-name-pattern="empty fixture"`
Expected: FAIL — cannot import `extract` (module not found).

- [ ] **Step 3: Create minimal `lib/heat/narrativeSignals.js`**

```js
/**
 * Narrative signal extraction for the Heat Thermometer.
 *
 * Pure function. No IO. Reads existing prospect_heat rows + the conversation's
 * message history, emits human-readable signal objects (label + quote + delta)
 * that explain why the heat moved.
 *
 * See: docs/superpowers/specs/2026-04-18-thermometre-rail-design.md
 *
 * @typedef {"pos"|"neg"} Polarity
 *
 * @typedef {object} NarrativeSignal
 * @property {string} kind                     Rule key — see rule table in spec
 * @property {string} label                    Short FR string displayed as <strong>
 * @property {string} quote                    Citation snippet (max 120 chars, word-bounded)
 * @property {Polarity} polarity
 * @property {number} delta                    Absolute value used for display
 * @property {string} when                     ISO timestamp of the triggering message
 * @property {string|null} message_id          Triggering message id (null for ghost/relance spans)
 *
 * @param {object} input
 * @param {Array<{id: string, role: "bot"|"user", content: string, created_at: string|Date}>} input.messages
 *   Ordered by created_at ASC.
 * @param {Array<{message_id: string, heat: number, delta: number|null, signals: object, created_at: string|Date}>} input.heatRows
 *   All prospect_heat rows for this conversation, ordered by created_at ASC.
 * @param {Date} [input.now=new Date()]
 * @param {number} [input.limit=8]
 * @returns {{signals: NarrativeSignal[], total: number}}
 */
export function extract({ messages = [], heatRows = [], now = new Date(), limit = 8 } = {}) {
  // v1: empty-case only. Subsequent tasks implement per-rule detectors.
  if (messages.length === 0) {
    return { signals: [], total: 0 };
  }
  return { signals: [], total: 0 };
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `npm test -- --test-name-pattern="empty fixture"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/heat/narrativeSignals.js test/narrative-signals.test.js
git commit -m "feat(heat): scaffold narrativeSignals.extract with empty-case path"
```

---

### Task 3: Implement `deriveState` (zone + direction)

**Files:**
- Modify: `lib/heat/narrativeSignals.js`
- Modify: `test/narrative-signals.test.js`

- [ ] **Step 1: Write failing tests for `deriveState`**

Add to `test/narrative-signals.test.js`:

```js
import { extract, deriveState } from "../lib/heat/narrativeSignals.js";

describe("deriveState", () => {
  it("maps heat ∈ [0, 0.25) to glacé", () => {
    assert.equal(deriveState(0.10, 0).state, "glacé");
    assert.equal(deriveState(0.249, 0).state, "glacé");
  });
  it("maps heat ∈ [0.25, 0.45) to froid", () => {
    assert.equal(deriveState(0.25, 0).state, "froid");
    assert.equal(deriveState(0.449, 0).state, "froid");
  });
  it("maps heat ∈ [0.45, 0.65) to tiède", () => {
    assert.equal(deriveState(0.50, 0).state, "tiède");
  });
  it("maps heat ∈ [0.65, 0.85) to chaud", () => {
    assert.equal(deriveState(0.70, 0).state, "chaud");
  });
  it("maps heat ≥ 0.85 to brûlant", () => {
    assert.equal(deriveState(0.90, 0).state, "brûlant");
    assert.equal(deriveState(1.00, 0).state, "brûlant");
  });
  it("direction montant for delta > 0.03", () => {
    assert.equal(deriveState(0.5, 0.04).direction, "montant");
  });
  it("direction descendant for delta < -0.03", () => {
    assert.equal(deriveState(0.5, -0.04).direction, "descendant");
  });
  it("direction stable for |delta| ≤ 0.03", () => {
    assert.equal(deriveState(0.5, 0.02).direction, "stable");
    assert.equal(deriveState(0.5, -0.02).direction, "stable");
    assert.equal(deriveState(0.5, 0).direction, "stable");
  });
  it("null heat returns null state and direction", () => {
    const r = deriveState(null, null);
    assert.equal(r.state, null);
    assert.equal(r.direction, null);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- --test-name-pattern="deriveState"`
Expected: FAIL — `deriveState` is not exported.

- [ ] **Step 3: Implement `deriveState` in `lib/heat/narrativeSignals.js`**

Add at the bottom of the file (before `extract`):

```js
/**
 * Derive the zone label + direction from a heat value and its delta.
 * @param {number|null} heat
 * @param {number|null} delta
 * @returns {{state: string|null, direction: string|null}}
 */
export function deriveState(heat, delta) {
  if (heat == null) return { state: null, direction: null };

  let state;
  if (heat < 0.25) state = "glacé";
  else if (heat < 0.45) state = "froid";
  else if (heat < 0.65) state = "tiède";
  else if (heat < 0.85) state = "chaud";
  else state = "brûlant";

  let direction;
  if (delta == null) direction = "stable";
  else if (delta > 0.03) direction = "montant";
  else if (delta < -0.03) direction = "descendant";
  else direction = "stable";

  return { state, direction };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- --test-name-pattern="deriveState"`
Expected: PASS — all 9 cases.

- [ ] **Step 5: Commit**

```bash
git add lib/heat/narrativeSignals.js test/narrative-signals.test.js
git commit -m "feat(heat): deriveState — zone label + direction from heat + delta"
```

---

### Task 4: Signal rule — `cold_lexical` (first detector, end-to-end through extract)

**Why first:** single-message rule, no cross-message logic, tests the whole pipeline (cold-refusal fixture).

**Files:**
- Modify: `lib/heat/narrativeSignals.js`
- Modify: `test/narrative-signals.test.js`

- [ ] **Step 1: Write failing test using cold-refusal fixture**

Add to `test/narrative-signals.test.js`:

```js
describe("extract — cold-refusal fixture", () => {
  const fx = loadFixture("cold-refusal");

  it("emits exactly one cold_lexical signal", () => {
    const { signals, total } = extract({
      messages: fx.messages,
      heatRows: fx.heatRows,
      now: new Date(fx.now),
    });
    assert.equal(total, 1);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].kind, "cold_lexical");
    assert.equal(signals[0].polarity, "neg");
    assert.match(signals[0].quote, /pas le temps/i);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- --test-name-pattern="cold-refusal"`
Expected: FAIL — signals array is still empty.

- [ ] **Step 3: Implement `cold_lexical` detector**

Add to `lib/heat/narrativeSignals.js`:

```js
// Lexical patterns — shared with prospectHeat.js (negative engagement).
const LEX_NEG = /\b(pas le temps|peut-?être|plus tard|pas intéressé|pas interesse|pas pour moi|je passe|non merci|stop|pas besoin|déjà|deja|on verra|je regarderai)\b/i;

const QUOTE_MAX = 120;

function truncateQuote(text, max = QUOTE_MAX) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 40 ? slice.slice(0, lastSpace) : slice) + "…";
}

/**
 * Extract a cold_lexical signal from a single prospect message, if its text
 * contains a negative-engagement phrase. Uses the paired prospect_heat delta
 * if available, otherwise assigns -0.10 synthetic.
 * @returns {NarrativeSignal|null}
 */
function detectColdLexical(msg, heatRow) {
  if (msg.role !== "user") return null;
  const m = msg.content.match(LEX_NEG);
  if (!m) return null;
  const delta = heatRow?.delta != null ? Math.abs(heatRow.delta) : 0.10;
  return {
    kind: "cold_lexical",
    label: "Verbalise refus/report",
    quote: truncateQuote(msg.content),
    polarity: "neg",
    delta,
    when: new Date(msg.created_at).toISOString(),
    message_id: msg.id,
  };
}
```

And update `extract` to run this detector:

```js
export function extract({ messages = [], heatRows = [], now = new Date(), limit = 8 } = {}) {
  const heatByMsg = new Map(heatRows.map(r => [r.message_id, r]));
  const raw = [];

  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const heatRow = heatByMsg.get(msg.id);
    const cold = detectColdLexical(msg, heatRow);
    if (cold) raw.push(cold);
  }

  // Newest-first, capped at `limit`
  const sorted = raw.sort((a, b) => new Date(b.when) - new Date(a.when));
  return { signals: sorted.slice(0, limit), total: raw.length };
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- --test-name-pattern="cold-refusal"`
Expected: PASS.

Also: `npm test -- --test-name-pattern="empty"` still PASS (empty.json has no user messages).

- [ ] **Step 5: Commit**

```bash
git add lib/heat/narrativeSignals.js test/narrative-signals.test.js
git commit -m "feat(heat): detect cold_lexical narrative signal + pipeline wiring"
```

---

## Chunk 2: Full detector set (call + engagement + outbound) + priority sort

### Task 5: Call-related signals — `accept_call`, `propose_call`, `gives_email`, `books_slot`

**Files:**
- Modify: `lib/heat/narrativeSignals.js`
- Modify: `test/narrative-signals.test.js`
- Create: `test/fixtures/heat-conversations/olga-maveilleia.json`
- Create: `test/fixtures/heat-conversations/edwige-maveilleia.json`
- Create: `test/fixtures/heat-conversations/cecilia-bluecoders.json`

- [ ] **Step 1: Create three fixtures from real conversations**

Create `test/fixtures/heat-conversations/cecilia-bluecoders.json`:

```json
{
  "name": "cecilia-bluecoders",
  "description": "Thomas × Cecilia — prospect proposes the call herself",
  "now": "2025-12-15T17:00:00Z",
  "messages": [
    { "id": "m1", "role": "bot", "content": "Salut Cecilia", "created_at": "2025-12-15T12:43:00Z" },
    { "id": "m2", "role": "bot", "content": "Je vois que tu es très active sur LinkedIn. Posts réguliers, engagement, tu portes bien l'image Bluecoders.", "created_at": "2025-12-15T12:43:30Z" },
    { "id": "m3", "role": "bot", "content": "C'est toi qui gères toute la com ou une stratégie portée par plusieurs membres ?", "created_at": "2025-12-15T12:44:00Z" },
    { "id": "m4", "role": "user", "content": "Hey Thomas, c'est moi toute seule", "created_at": "2025-12-15T14:14:00Z" },
    { "id": "m5", "role": "user", "content": "merci pour ton message", "created_at": "2025-12-15T14:14:30Z" },
    { "id": "m6", "role": "bot", "content": "Ça veut dire que tu fais tout en solo : contenu, engagement, la signature Bluecoders sur le réseau.", "created_at": "2025-12-15T15:47:00Z" },
    { "id": "m7", "role": "bot", "content": "Comment tu trouves le temps entre la COO et LinkedIn ?", "created_at": "2025-12-15T15:47:30Z" },
    { "id": "m8", "role": "bot", "content": "Et je me demandais, ça pourrait avoir du sens d'embarquer tes salariés dans de la comm LinkedIn ?", "created_at": "2025-12-15T15:48:00Z" },
    { "id": "m9", "role": "user", "content": "On peut en discuter de vive voix si tu veux :)", "created_at": "2025-12-15T16:58:00Z" }
  ],
  "heatRows": [
    { "message_id": "m4", "heat": 0.45, "delta": null, "signals": {}, "created_at": "2025-12-15T14:14:00Z" },
    { "message_id": "m5", "heat": 0.48, "delta": 0.03, "signals": {}, "created_at": "2025-12-15T14:14:30Z" },
    { "message_id": "m9", "heat": 0.82, "delta": 0.34, "signals": {}, "created_at": "2025-12-15T16:58:00Z" }
  ],
  "expected": {
    "includes_kinds": ["propose_call"],
    "excludes_kinds": ["accept_call"],
    "current": { "state": "chaud", "direction": "montant" }
  }
}
```

Create `test/fixtures/heat-conversations/edwige-maveilleia.json`:

```json
{
  "name": "edwige-maveilleia",
  "description": "Adrien × Edwige — quick yes, prospect proposes visio at msg 2",
  "now": "2026-03-17T13:00:00Z",
  "messages": [
    { "id": "m1", "role": "bot", "content": "Salut Edwige, tu accompagnes des entrepreneurs sur leur positionnement de marque, la question de comment ils apparaissent sur ChatGPT ou Perplexity, c'est quelque chose que tes clients te posent déjà ?", "created_at": "2026-03-17T11:12:00Z" },
    { "id": "m2", "role": "bot", "content": "Je lance un SaaS qui mesure ça, je fais des démos gratuites et je cherche du feedback. Ça pourrait valoir un petit échange ?", "created_at": "2026-03-17T11:12:30Z" },
    { "id": "m3", "role": "user", "content": "Bonjour Adrien, En effet c'est un sujet qui fait partie des préoccupations de mes clients. Intéressée par un échange avec toi et une démo. Comment tu vois les choses? On bloque une visio dans les agendas ?", "created_at": "2026-03-17T12:13:00Z" },
    { "id": "m4", "role": "bot", "content": "Oui top ! Je t'envoie mon agenda : https://cal.com/team/maveilleia/demo-maveilleia", "created_at": "2026-03-17T12:18:00Z" }
  ],
  "heatRows": [
    { "message_id": "m3", "heat": 0.88, "delta": null, "signals": {}, "created_at": "2026-03-17T12:13:00Z" }
  ],
  "expected": {
    "includes_kinds": ["propose_call"],
    "current": { "state": "brûlant", "direction": "stable" }
  }
}
```

Create `test/fixtures/heat-conversations/olga-maveilleia.json`:

```json
{
  "name": "olga-maveilleia",
  "description": "Adrien × Olga — Adrien proposes, Olga accepts + gives date + email",
  "now": "2026-03-10T14:00:00Z",
  "messages": [
    { "id": "m1", "role": "bot", "content": "Salut Olga, j'échange avec des indé qui développent l'image de marque. Tu aimerais ajouter le GEO comme compétence ?", "created_at": "2026-03-08T09:48:00Z" },
    { "id": "m2", "role": "user", "content": "Bonjour Adrien ! Ça m'intéresse. Au plaisir d'échanger", "created_at": "2026-03-08T10:33:00Z" },
    { "id": "m3", "role": "bot", "content": "Ok top ! Ca te dit une visio ?", "created_at": "2026-03-08T10:47:00Z" },
    { "id": "m4", "role": "user", "content": "Oui, je suis disponible le mercredi 15 si c'est faisable pour toi", "created_at": "2026-03-08T11:52:00Z" },
    { "id": "m5", "role": "bot", "content": "Oui, c'est nickel pour le 15. Tu as un email à me partager stp ?", "created_at": "2026-03-08T12:06:00Z" },
    { "id": "m6", "role": "user", "content": "avenuejolia@gmail.com", "created_at": "2026-03-08T12:06:30Z" }
  ],
  "heatRows": [
    { "message_id": "m2", "heat": 0.70, "delta": null, "signals": {}, "created_at": "2026-03-08T10:33:00Z" },
    { "message_id": "m4", "heat": 0.85, "delta": 0.15, "signals": {}, "created_at": "2026-03-08T11:52:00Z" },
    { "message_id": "m6", "heat": 0.90, "delta": 0.05, "signals": {}, "created_at": "2026-03-08T12:06:30Z" }
  ],
  "expected": {
    "includes_kinds": ["accept_call", "books_slot", "gives_email"],
    "current": { "state": "brûlant", "direction": "stable" }
  }
}
```

- [ ] **Step 2: Write failing tests against the three fixtures**

Add to `test/narrative-signals.test.js`:

```js
// Helper: check that signals contains every kind in `expected.includes_kinds`
function assertContainsKinds(signals, kinds) {
  const foundKinds = new Set(signals.map(s => s.kind));
  for (const k of kinds) {
    assert.ok(foundKinds.has(k), `expected kind "${k}" in signals, got [${[...foundKinds].join(", ")}]`);
  }
}

describe("extract — call-related signals", () => {
  it("cecilia-bluecoders: detects propose_call", () => {
    const fx = loadFixture("cecilia-bluecoders");
    const { signals } = extract({ messages: fx.messages, heatRows: fx.heatRows, now: new Date(fx.now) });
    assertContainsKinds(signals, fx.expected.includes_kinds);
    const propose = signals.find(s => s.kind === "propose_call");
    assert.match(propose.quote, /de vive voix/i);
  });

  it("edwige-maveilleia: detects propose_call in a single message", () => {
    const fx = loadFixture("edwige-maveilleia");
    const { signals } = extract({ messages: fx.messages, heatRows: fx.heatRows, now: new Date(fx.now) });
    assertContainsKinds(signals, fx.expected.includes_kinds);
  });

  it("olga-maveilleia: detects accept_call + books_slot + gives_email", () => {
    const fx = loadFixture("olga-maveilleia");
    const { signals } = extract({ messages: fx.messages, heatRows: fx.heatRows, now: new Date(fx.now) });
    assertContainsKinds(signals, fx.expected.includes_kinds);
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npm test -- --test-name-pattern="call-related"`
Expected: FAIL on all three — detectors not implemented.

- [ ] **Step 4: Implement the four detectors in `lib/heat/narrativeSignals.js`**

```js
// ── Lexical + pattern fragments ──────────────────────────────────────────
const RE_CALL_KEYWORD = /\b(call|visio|appel|rdv|discuter)\b/i;
const RE_ACCEPT = /\b(oui|carrément|carrement|yes|ok|d'accord|d accord|avec plaisir|pas de soucis|pas de souci|why not)\b/i;
const RE_PROPOSE_CALL = /\b(de vive voix|bloque.* (?:visio|agenda|créneau|creneau|rdv|call)|on peut (?:en )?(?:discuter|échanger|echanger) (?:de vive voix|autour d'un call)?|je suis disponible|on se cale un? (?:call|visio|rdv)|bloquer? dans les agendas|prendre.* créneau|je te propose un (?:call|rdv))\b/i;
const RE_EMAIL = /\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i;
const RE_BOOKS_SLOT = /\b(j'ai booké|c'est booké|c'est tout bon|(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)[^.?!]*\b(?:à|a)\s?\d{1,2}[h:]\d{0,2}?|le \d{1,2}[^.?!]*\b\d{1,2}[h:])/i;

/**
 * Detect if a prospect message accepts a call that was proposed by the clone
 * in the previous bot message(s).
 */
function detectAcceptCall(msg, prevBotContent, heatRow) {
  if (msg.role !== "user") return null;
  if (!RE_ACCEPT.test(msg.content)) return null;
  if (!prevBotContent || !RE_CALL_KEYWORD.test(prevBotContent)) return null;
  return {
    kind: "accept_call",
    label: "Accepte le call",
    quote: truncateQuote(msg.content.trim()),
    polarity: "pos",
    delta: heatRow?.delta != null ? Math.abs(heatRow.delta) : 0.20,
    when: new Date(msg.created_at).toISOString(),
    message_id: msg.id,
  };
}

/**
 * Prospect initiates/proposes a call on their own ("on peut discuter de vive voix",
 * "on bloque une visio", "je suis disponible…").
 */
function detectProposeCall(msg, heatRow) {
  if (msg.role !== "user") return null;
  if (!RE_PROPOSE_CALL.test(msg.content)) return null;
  const m = msg.content.match(RE_PROPOSE_CALL);
  return {
    kind: "propose_call",
    label: "Propose le call elle-même",
    quote: truncateQuote(m ? msg.content.slice(Math.max(0, m.index - 10)) : msg.content),
    polarity: "pos",
    delta: heatRow?.delta != null ? Math.abs(heatRow.delta) : 0.25,
    when: new Date(msg.created_at).toISOString(),
    message_id: msg.id,
  };
}

function detectGivesEmail(msg, heatRow) {
  if (msg.role !== "user") return null;
  const m = msg.content.match(RE_EMAIL);
  if (!m) return null;
  const email = m[1];
  const masked = email.replace(/^(.{2}).*(@.*)$/, "$1…$2");
  return {
    kind: "gives_email",
    label: "Donne son email",
    quote: masked,
    polarity: "pos",
    delta: heatRow?.delta != null ? Math.abs(heatRow.delta) : 0.15,
    when: new Date(msg.created_at).toISOString(),
    message_id: msg.id,
  };
}

function detectBooksSlot(msg, heatRow) {
  if (msg.role !== "user") return null;
  if (!RE_BOOKS_SLOT.test(msg.content)) return null;
  return {
    kind: "books_slot",
    label: "Confirme un créneau",
    quote: truncateQuote(msg.content.trim()),
    polarity: "pos",
    delta: heatRow?.delta != null ? Math.abs(heatRow.delta) : 0.20,
    when: new Date(msg.created_at).toISOString(),
    message_id: msg.id,
  };
}
```

Update `extract` to wire these detectors:

```js
export function extract({ messages = [], heatRows = [], now = new Date(), limit = 8 } = {}) {
  const heatByMsg = new Map(heatRows.map(r => [r.message_id, r]));
  const raw = [];

  let prevBotContent = "";
  for (const msg of messages) {
    if (msg.role === "bot") {
      prevBotContent = msg.content;
      continue;
    }
    // role === "user" — prospect message
    const heatRow = heatByMsg.get(msg.id);

    // Detectors — run in priority order but collect all matches for this msg
    const candidates = [
      detectBooksSlot(msg, heatRow),
      detectAcceptCall(msg, prevBotContent, heatRow),
      detectProposeCall(msg, heatRow),
      detectGivesEmail(msg, heatRow),
      detectColdLexical(msg, heatRow),
    ].filter(Boolean);

    for (const c of candidates) raw.push(c);
  }

  const sorted = raw.sort((a, b) => new Date(b.when) - new Date(a.when));
  return { signals: sorted.slice(0, limit), total: raw.length };
}
```

- [ ] **Step 5: Run all tests**

Run: `npm test -- --test-name-pattern="narrativeSignals|extract|deriveState"`
Expected: all previous + new tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/heat/narrativeSignals.js test/narrative-signals.test.js test/fixtures/heat-conversations/cecilia-bluecoders.json test/fixtures/heat-conversations/edwige-maveilleia.json test/fixtures/heat-conversations/olga-maveilleia.json
git commit -m "feat(heat): detect accept_call / propose_call / gives_email / books_slot"
```

---

### Task 6: Engagement signals — `business_context`, `positive_interest`, `question_back`

**Files:**
- Modify: `lib/heat/narrativeSignals.js`
- Modify: `test/narrative-signals.test.js`
- Create: `test/fixtures/heat-conversations/nathalie-maveilleia.json`
- Create: `test/fixtures/heat-conversations/hassan-immostates.json`

- [ ] **Step 1: Create the two fixtures**

Create `test/fixtures/heat-conversations/nathalie-maveilleia.json`:

```json
{
  "name": "nathalie-maveilleia",
  "description": "Adrien × Nathalie — prospect details tool stack + books Monday slot",
  "now": "2026-03-14T15:00:00Z",
  "messages": [
    { "id": "m1", "role": "bot", "content": "Salut Nathalie, tu réfléchis sûrement à comment tes clients apparaissent sur les nouveaux moteurs de recherche IA. Le GEO est un sujet sur lequel tu te penches ?", "created_at": "2026-03-14T12:22:00Z" },
    { "id": "m2", "role": "user", "content": "Hello, effectivement, je commence à avoir des presta GEO avec les causantes. Je bosse avec Getmint pour le moment. Je teste le content studio en ayant relié la Search Console dessus, les premiers contenus produits sont pas mals. Lundi ou mardi prochain, j'ai pas de dispo avant.", "created_at": "2026-03-14T12:58:00Z" },
    { "id": "m3", "role": "bot", "content": "Ok top ! je connais bien GetMint. Vous avez 30 minutes cette semaine pour que je vous montre la différence en live ?", "created_at": "2026-03-14T13:32:00Z" },
    { "id": "m4", "role": "user", "content": "Lundi 11h30 me paraît bien. Voici mon email : nathalie.delmas@lescausantes.com", "created_at": "2026-03-14T13:58:00Z" }
  ],
  "heatRows": [
    { "message_id": "m2", "heat": 0.75, "delta": null, "signals": {}, "created_at": "2026-03-14T12:58:00Z" },
    { "message_id": "m4", "heat": 0.92, "delta": 0.17, "signals": {}, "created_at": "2026-03-14T13:58:00Z" }
  ],
  "expected": {
    "includes_kinds": ["business_context", "books_slot", "gives_email"],
    "current": { "state": "brûlant", "direction": "montant" }
  }
}
```

Create `test/fixtures/heat-conversations/hassan-immostates.json`:

```json
{
  "name": "hassan-immostates",
  "description": "Thierry × Hassan — discovery dance on fractional vs crowdfunding + accept",
  "now": "2025-12-10T12:00:00Z",
  "messages": [
    { "id": "m1", "role": "bot", "content": "Salut Hassan comment tu vas?", "created_at": "2025-11-20T15:36:00Z" },
    { "id": "m2", "role": "user", "content": "Salut Gaetan c'est plutôt ton concept dans sa globalité que je trouve intéressant 👍🏽", "created_at": "2025-11-20T17:05:00Z" },
    { "id": "m3", "role": "bot", "content": "Je suis curieux de savoir, c'est plutôt le marché US, le modèle fractionné, ou les rendements qui t'attirent le plus ?", "created_at": "2025-11-20T18:46:00Z" },
    { "id": "m4", "role": "user", "content": "Le modèle fractionné que je trouves intéressant même si je penses qu'il n'est pas assez connu du grand public comme un vrai modèle d'investissement pour des revenus passifs… tu penses que c'est dû à quoi ?", "created_at": "2025-11-20T20:00:00Z" },
    { "id": "m5", "role": "bot", "content": "Je pense que le modèle fractionné est encore peu connu parce qu'il sort des codes habituels de l'immo.", "created_at": "2025-11-20T20:07:00Z" },
    { "id": "m6", "role": "user", "content": "Parce que tu fais la différence entre le crowdfunding et l'immobilier fractionné ? Au niveau de la réglementation c'est souvent pareil non ?", "created_at": "2025-12-09T16:05:00Z" },
    { "id": "m7", "role": "bot", "content": "ce que je te propose c'est que l'on continue cette discussion autour d'un call qu'est ce que t'en dis ?", "created_at": "2025-12-10T10:55:00Z" },
    { "id": "m8", "role": "user", "content": "Oui, avec plaisir", "created_at": "2025-12-10T11:47:00Z" }
  ],
  "heatRows": [
    { "message_id": "m2", "heat": 0.55, "delta": null, "signals": {}, "created_at": "2025-11-20T17:05:00Z" },
    { "message_id": "m4", "heat": 0.65, "delta": 0.10, "signals": {}, "created_at": "2025-11-20T20:00:00Z" },
    { "message_id": "m6", "heat": 0.55, "delta": -0.10, "signals": {}, "created_at": "2025-12-09T16:05:00Z" },
    { "message_id": "m8", "heat": 0.80, "delta": 0.25, "signals": {}, "created_at": "2025-12-10T11:47:00Z" }
  ],
  "expected": {
    "includes_kinds": ["question_back", "accept_call"],
    "current": { "state": "chaud", "direction": "montant" }
  }
}
```

- [ ] **Step 2: Write failing tests**

Add to `test/narrative-signals.test.js`:

```js
describe("extract — engagement signals", () => {
  it("nathalie-maveilleia: business_context + books_slot + gives_email", () => {
    const fx = loadFixture("nathalie-maveilleia");
    const { signals } = extract({ messages: fx.messages, heatRows: fx.heatRows, now: new Date(fx.now) });
    assertContainsKinds(signals, fx.expected.includes_kinds);
  });
  it("hassan-immostates: question_back + accept_call", () => {
    const fx = loadFixture("hassan-immostates");
    const { signals } = extract({ messages: fx.messages, heatRows: fx.heatRows, now: new Date(fx.now) });
    assertContainsKinds(signals, fx.expected.includes_kinds);
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npm test -- --test-name-pattern="engagement signals"`
Expected: FAIL — `business_context`, `positive_interest`, `question_back` not implemented.

- [ ] **Step 4: Implement the three detectors**

Add to `lib/heat/narrativeSignals.js`:

```js
const LEX_POS = /\b(intéressant|interessant|super|parfait|curieux|ok|top|nice|carrément|carrement|avec plaisir|en effet)\b/i;
const BUSINESS_TERMS = /\b(client|équipe|equipe|biz|marché|marche|portfolio|boîte|boite|saas|startup|produit|chiffre|CA|revenu|mission|prestation|secteur|vertical|cible)\b/i;
const CURIOSITY = /\b(comment|pourquoi|qu'est-ce que|tu peux m'en dire plus|dis-m'en plus|raconte|tu penses que)\b/i;

function wordCount(text) {
  return (text.match(/\S+/g) || []).length;
}

function firstSentence(text, max = QUOTE_MAX) {
  const stop = text.search(/[.!?]/);
  const s = (stop === -1 ? text : text.slice(0, stop + 1)).trim();
  return truncateQuote(s, max);
}

function detectBusinessContext(msg, heatRow) {
  if (msg.role !== "user") return null;
  if (wordCount(msg.content) < 80) return null;
  if (!BUSINESS_TERMS.test(msg.content)) return null;
  return {
    kind: "business_context",
    label: "Détaille son contexte",
    quote: firstSentence(msg.content),
    polarity: "pos",
    delta: heatRow?.delta != null ? Math.abs(heatRow.delta) : 0.15,
    when: new Date(msg.created_at).toISOString(),
    message_id: msg.id,
  };
}

function detectPositiveInterest(msg, heatRow, alreadyMatched) {
  if (msg.role !== "user") return null;
  // Skip if higher-priority rules matched the same message
  if (alreadyMatched) return null;
  const m = msg.content.match(LEX_POS);
  if (!m) return null;
  // Use heat-row lexical threshold when available, otherwise fall through on regex alone
  const heatSignals = heatRow?.signals || {};
  if (heatSignals.lexical != null && heatSignals.lexical < 0.75) return null;
  // Extract the sentence containing the match
  const sentences = msg.content.split(/(?<=[.!?])\s+/);
  const matched = sentences.find(s => LEX_POS.test(s)) || m[0];
  return {
    kind: "positive_interest",
    label: "Verbalise intérêt",
    quote: truncateQuote(matched.trim()),
    polarity: "pos",
    delta: heatRow?.delta != null ? Math.abs(heatRow.delta) : 0.10,
    when: new Date(msg.created_at).toISOString(),
    message_id: msg.id,
  };
}

function detectQuestionBack(msg, heatRow) {
  if (msg.role !== "user") return null;
  if (!msg.content.trim().endsWith("?")) return null;
  if (!CURIOSITY.test(msg.content)) return null;
  // Use the last question sentence as quote
  const sentences = msg.content.split(/(?<=[.!?])\s+/);
  const lastQ = [...sentences].reverse().find(s => s.trim().endsWith("?")) || msg.content;
  return {
    kind: "question_back",
    label: "Pose une question en retour",
    quote: truncateQuote(lastQ.trim()),
    polarity: "pos",
    delta: heatRow?.delta != null ? Math.abs(heatRow.delta) : 0.10,
    when: new Date(msg.created_at).toISOString(),
    message_id: msg.id,
  };
}
```

Update the candidate list inside `extract` (keep priority order per spec):

```js
    const candidates = [];
    const push = (s) => { if (s) candidates.push(s); };
    push(detectBooksSlot(msg, heatRow));
    push(detectAcceptCall(msg, prevBotContent, heatRow));
    push(detectProposeCall(msg, heatRow));
    push(detectGivesEmail(msg, heatRow));
    push(detectQuestionBack(msg, heatRow));
    push(detectBusinessContext(msg, heatRow));
    push(detectColdLexical(msg, heatRow));
    // positive_interest only if nothing stronger matched this message
    push(detectPositiveInterest(msg, heatRow, candidates.length > 0));
    for (const c of candidates) raw.push(c);
```

- [ ] **Step 5: Run all tests**

Run: `npm test -- --test-name-pattern="extract"`
Expected: all previous + new tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/heat/narrativeSignals.js test/narrative-signals.test.js test/fixtures/heat-conversations/nathalie-maveilleia.json test/fixtures/heat-conversations/hassan-immostates.json
git commit -m "feat(heat): business_context, positive_interest, question_back detectors"
```

---

### Task 7: Outbound-only signals — `ghost_2days`, `relance_unanswered`

**Files:**
- Modify: `lib/heat/narrativeSignals.js`
- Modify: `test/narrative-signals.test.js`
- Create: `test/fixtures/heat-conversations/daniel-immostates.json`
- Create: `test/fixtures/heat-conversations/theotime-maveilleia.json`
- Create: `test/fixtures/heat-conversations/pierre-immostates.json`

- [ ] **Step 1: Create the three fixtures**

Create `test/fixtures/heat-conversations/daniel-immostates.json` (abridged — only the key turns that trigger relance/ghost signals):

```json
{
  "name": "daniel-immostates",
  "description": "Thierry × Daniel — 87 days, 6 relances, ghost then revival, finally books",
  "now": "2026-02-11T10:00:00Z",
  "messages": [
    { "id": "m1", "role": "bot", "content": "hey Daniel, l'immo fractionné ça te parle ?", "created_at": "2025-12-17T12:38:00Z" },
    { "id": "m2", "role": "bot", "content": "hey Daniel, c'est bien toi ?", "created_at": "2025-12-18T17:43:00Z" },
    { "id": "m3", "role": "bot", "content": "What's up Daniel, l'immo fractionné ça te parle ?", "created_at": "2026-01-27T13:22:00Z" },
    { "id": "m4", "role": "bot", "content": "Hey, je me permets de te relancer pour savoir si tu avais vu mon message ?", "created_at": "2026-01-30T20:26:00Z" },
    { "id": "m5", "role": "user", "content": "Bonjour Thierry, désolé pour le temps de réponse. Effectivement je suis intéressé par de l'investissement. J'aimerai me diversifier.", "created_at": "2026-02-02T22:36:00Z" },
    { "id": "m6", "role": "bot", "content": "Bonjour Daniel, tu as déjà une stratégie d'investissement ou c'est un premier pas vers la diversification ? On propose de l'immo locatif aux US dès 1 000€.", "created_at": "2026-02-05T17:43:00Z" },
    { "id": "m7", "role": "bot", "content": "Mon message s'est perdu dans votre inbox ?", "created_at": "2026-02-09T11:23:00Z" },
    { "id": "m8", "role": "user", "content": "J'ai exploré crypto, Forex, actions. J'ai deux appartements en location en France et je suis sur l'acquisition d'un troisième bien. L'investissement à l'étranger peut m'intéresser, d'où l'ajout sur LinkedIn.", "created_at": "2026-02-11T07:34:00Z" }
  ],
  "heatRows": [
    { "message_id": "m5", "heat": 0.45, "delta": null, "signals": {}, "created_at": "2026-02-02T22:36:00Z" },
    { "message_id": "m8", "heat": 0.70, "delta": 0.25, "signals": {}, "created_at": "2026-02-11T07:34:00Z" }
  ],
  "expected": {
    "includes_kinds": ["relance_unanswered", "business_context"],
    "current": { "state": "chaud", "direction": "montant" }
  }
}
```

Create `test/fixtures/heat-conversations/theotime-maveilleia.json`:

```json
{
  "name": "theotime-maveilleia",
  "description": "Adrien × Theotime — delayed reply after silence → eventual RDV",
  "now": "2026-04-13T12:00:00Z",
  "messages": [
    { "id": "m1", "role": "bot", "content": "Salut Theotime, le GEO c'est quelque chose que tes clients commencent à te poser ? Je lance un SaaS, preneur de retour.", "created_at": "2026-03-30T14:33:00Z" },
    { "id": "m2", "role": "user", "content": "Bonjour Adrien, on développe des landing pages qu'on tente d'optimiser pour le GEO. Tu peux m'en dire plus sur ton SaaS ?", "created_at": "2026-03-30T21:51:00Z" },
    { "id": "m3", "role": "bot", "content": "Salut, MaveilleIA mesure la visibilité IA de vos clients. Je peux te faire une démo. Tu as un créneau à me proposer (et un email) ?", "created_at": "2026-04-03T09:13:00Z" },
    { "id": "m4", "role": "user", "content": "Bonjour Adrien, je faisais le tour de mes messages et j'ai remarqué que je ne t'avais pas répondu. Intéressé par la démo. Voici mon email : theotime@mtsolution.fr", "created_at": "2026-04-10T16:56:00Z" }
  ],
  "heatRows": [
    { "message_id": "m2", "heat": 0.55, "delta": null, "signals": {}, "created_at": "2026-03-30T21:51:00Z" },
    { "message_id": "m4", "heat": 0.78, "delta": 0.23, "signals": {}, "created_at": "2026-04-10T16:56:00Z" }
  ],
  "expected": {
    "includes_kinds": ["ghost_2days", "gives_email"],
    "current": { "state": "chaud", "direction": "montant" }
  }
}
```

Create `test/fixtures/heat-conversations/pierre-immostates.json`:

```json
{
  "name": "pierre-immostates",
  "description": "Thierry × Pierre — 1 msg, prospect already interested, proposes call",
  "now": "2025-09-15T22:00:00Z",
  "messages": [
    { "id": "m1", "role": "bot", "content": "Bonjour Pierre, je vais droit au but : je me demandais si vous étiez intéressé par l'investissement US ? Vous souhaitez en savoir plus ?", "created_at": "2025-09-15T14:49:00Z" },
    { "id": "m2", "role": "user", "content": "Bonjour Thierry. Merci pour votre message, j'ai parcouru votre site et je comptais vous contacter. J'aimerai en savoir plus.", "created_at": "2025-09-15T15:37:00Z" },
    { "id": "m3", "role": "bot", "content": "Vous êtes plus en recherche de ressource documentaire ou vous souhaitez qu'on échange de vive voix ?", "created_at": "2025-09-15T15:49:00Z" },
    { "id": "m4", "role": "user", "content": "Je souhaiterais plutôt échanger de vive voix", "created_at": "2025-09-15T21:36:00Z" }
  ],
  "heatRows": [
    { "message_id": "m2", "heat": 0.72, "delta": null, "signals": {}, "created_at": "2025-09-15T15:37:00Z" },
    { "message_id": "m4", "heat": 0.88, "delta": 0.16, "signals": {}, "created_at": "2025-09-15T21:36:00Z" }
  ],
  "expected": {
    "includes_kinds": ["propose_call"],
    "current": { "state": "brûlant", "direction": "montant" }
  }
}
```

- [ ] **Step 2: Write failing tests for ghost + relance**

Add to `test/narrative-signals.test.js`:

```js
describe("extract — outbound-only signals", () => {
  it("daniel-immostates: detects relance_unanswered (multiple outbounds without response)", () => {
    const fx = loadFixture("daniel-immostates");
    const { signals } = extract({ messages: fx.messages, heatRows: fx.heatRows, now: new Date(fx.now) });
    assertContainsKinds(signals, fx.expected.includes_kinds);
  });

  it("theotime-maveilleia: detects ghost_2days (48h+ after outbound)", () => {
    const fx = loadFixture("theotime-maveilleia");
    const { signals } = extract({ messages: fx.messages, heatRows: fx.heatRows, now: new Date(fx.now) });
    assertContainsKinds(signals, fx.expected.includes_kinds);
  });

  it("pierre-immostates: detects propose_call (sanity, no ghost or relance)", () => {
    const fx = loadFixture("pierre-immostates");
    const { signals } = extract({ messages: fx.messages, heatRows: fx.heatRows, now: new Date(fx.now) });
    const kinds = new Set(signals.map(s => s.kind));
    assert.ok(kinds.has("propose_call"), "expected propose_call");
    assert.ok(!kinds.has("ghost_2days"), "ghost_2days should not fire — prospect replied same day");
    assert.ok(!kinds.has("relance_unanswered"), "no consecutive outbounds here");
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npm test -- --test-name-pattern="outbound-only"`
Expected: FAIL — detectors missing.

- [ ] **Step 4: Implement the two detectors**

Add to `lib/heat/narrativeSignals.js`:

```js
const GHOST_MS = 48 * 3600 * 1000;
const MAX_GHOST_DELTA = 0.15;

/**
 * Ghost signal: there IS a last outbound (bot) message AND no inbound since, AND
 * it's been ≥ 48h. Emitted at most once per conversation (the latest ghost).
 * @returns {NarrativeSignal|null}
 */
function detectGhost(messages, now) {
  // Find the last bot message and the last user message
  let lastBot = null, lastUser = null;
  for (const m of messages) {
    if (m.role === "bot") lastBot = m;
    else if (m.role === "user") lastUser = m;
  }
  if (!lastBot) return null;
  // Ghost only if bot is AFTER the last user message (awaiting response)
  if (lastUser && new Date(lastUser.created_at) >= new Date(lastBot.created_at)) return null;
  const ms = now.getTime() - new Date(lastBot.created_at).getTime();
  if (ms < GHOST_MS) return null;
  const days = Math.floor(ms / (24 * 3600 * 1000));
  return {
    kind: "ghost_2days",
    label: days >= 7 ? `${days} jours sans réponse` : "2+ jours de silence",
    quote: `${days} jour${days > 1 ? "s" : ""} depuis le dernier envoi`,
    polarity: "neg",
    delta: 0.08,
    when: lastBot.created_at,
    message_id: null,
  };
}

/**
 * Relance signal: ≥ 2 consecutive bot messages without any user message between.
 * Emitted once per streak (the latest streak).
 * @returns {NarrativeSignal|null}
 */
function detectRelanceUnanswered(messages) {
  // Walk from the end: count consecutive bot messages before the last user.
  let streak = 0;
  let firstOfStreak = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") break;
    if (m.role === "bot") {
      streak++;
      firstOfStreak = m;
    }
  }
  if (streak < 2) return null;
  const delta = Math.min(MAX_GHOST_DELTA, 0.05 * streak);
  return {
    kind: "relance_unanswered",
    label: `${streak} relances sans réponse`,
    quote: `${streak} messages envoyés, pas de retour`,
    polarity: "neg",
    delta,
    when: firstOfStreak.created_at,
    message_id: null,
  };
}
```

Wire into `extract` (after the per-message loop):

```js
  // Outbound-only signals (once per conversation)
  const ghost = detectGhost(messages, now);
  if (ghost) raw.push(ghost);
  const relance = detectRelanceUnanswered(messages);
  if (relance) raw.push(relance);

  const sorted = raw.sort((a, b) => new Date(b.when) - new Date(a.when));
  return { signals: sorted.slice(0, limit), total: raw.length };
}
```

Note: **one** of ghost / relance may fire on the same state (bot sent several messages, then 48h+ without reply). That's intentional — both are legitimate signals.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/heat/narrativeSignals.js test/narrative-signals.test.js test/fixtures/heat-conversations/daniel-immostates.json test/fixtures/heat-conversations/theotime-maveilleia.json test/fixtures/heat-conversations/pierre-immostates.json
git commit -m "feat(heat): ghost_2days + relance_unanswered outbound-only signals"
```

---

### Task 8: Priority ordering + combined extractor export

**Files:**
- Modify: `lib/heat/narrativeSignals.js`
- Modify: `test/narrative-signals.test.js`

- [ ] **Step 1: Write failing test for priority ordering**

Add to `test/narrative-signals.test.js`:

```js
describe("extract — priority ordering", () => {
  it("sorts signals from the same message by kind priority", () => {
    // Synthetic case: prospect says yes to a call AND gives email in one message
    const messages = [
      { id: "b1", role: "bot", content: "On se cale un call ?", created_at: "2026-04-18T10:00:00Z" },
      { id: "u1", role: "user", content: "Oui, mon email : test@example.com", created_at: "2026-04-18T10:01:00Z" },
    ];
    const heatRows = [
      { message_id: "u1", heat: 0.8, delta: 0.3, signals: {}, created_at: "2026-04-18T10:01:00Z" },
    ];
    const { signals } = extract({ messages, heatRows, now: new Date("2026-04-18T10:05:00Z") });
    // Both signals from the same message should appear, accept_call BEFORE gives_email
    const kinds = signals.filter(s => s.message_id === "u1").map(s => s.kind);
    assert.deepEqual(kinds, ["accept_call", "gives_email"]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- --test-name-pattern="priority ordering"`
Expected: FAIL (currently sorted only by timestamp — within same message, order is insertion order which may not match the documented priority).

- [ ] **Step 3: Add priority-preserving sort**

Modify `lib/heat/narrativeSignals.js` — replace the final sort with a stable sort that uses priority for ties:

```js
const KIND_PRIORITY = [
  "books_slot",
  "accept_call",
  "propose_call",
  "gives_email",
  "positive_interest",
  "question_back",
  "business_context",
  "cold_lexical",
  "relance_unanswered",
  "ghost_2days",
];
const kindRank = Object.fromEntries(KIND_PRIORITY.map((k, i) => [k, i]));

// … at the end of extract() …
  const sorted = raw.sort((a, b) => {
    const t = new Date(b.when) - new Date(a.when);
    if (t !== 0) return t;
    return (kindRank[a.kind] ?? 99) - (kindRank[b.kind] ?? 99);
  });
  return { signals: sorted.slice(0, limit), total: raw.length };
```

- [ ] **Step 4: Run all tests to confirm pass + no regressions**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/heat/narrativeSignals.js test/narrative-signals.test.js
git commit -m "feat(heat): priority-preserving sort for same-timestamp signals"
```

---

## Chunk 3: API endpoint + SSE integration

### Task 9: `GET /api/heat` endpoint

**Files:**
- Create: `api/heat.js`
- Create: `test/api-heat.test.js`

- [ ] **Step 1: Read existing API patterns**

Inspect `api/fidelity.js` and `api/chat.js` (first 50 lines of each) to copy the auth + Supabase boilerplate exactly. Do NOT invent a new pattern — use the existing one.

- [ ] **Step 2: Write the failing integration test**

Because the endpoint hits Supabase, we gate the test on the presence of env vars. Create `test/api-heat.test.js`:

```js
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// Integration tests are opt-in — only run if SUPABASE_URL and SUPABASE_SERVICE_ROLE are set.
const HAS_DB = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE);

describe("GET /api/heat", { skip: !HAS_DB && "no DB env vars" }, () => {
  it("returns 400 when conversation_id is missing", async () => {
    const handler = (await import("../api/heat.js")).default;
    const req = { method: "GET", query: {}, headers: {} };
    let statusCode, body;
    const res = {
      status(c) { statusCode = c; return this; },
      json(b) { body = b; return this; },
    };
    await handler(req, res);
    assert.equal(statusCode, 400);
    assert.match(body.error, /conversation_id/i);
  });

  it("returns the heat shape for an existing conversation", async () => {
    // This test requires a fixture conv in the DB. Skip if integration smoke not set up.
    const CONV_ID = process.env.TEST_HEAT_CONV_ID;
    if (!CONV_ID) return; // skip silently
    const handler = (await import("../api/heat.js")).default;
    const req = { method: "GET", query: { conversation_id: CONV_ID }, headers: { authorization: "Bearer " + (process.env.TEST_ACCESS_CODE || "") } };
    let statusCode, body;
    const res = {
      status(c) { statusCode = c; return this; },
      json(b) { body = b; return this; },
    };
    await handler(req, res);
    assert.equal(statusCode, 200);
    assert.ok("current" in body);
    assert.ok(Array.isArray(body.signals));
    assert.ok(typeof body.total_signals === "number");
  });
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `npm test -- --test-name-pattern="GET /api/heat"`
Expected: FAIL (module missing) OR skip (no env).

- [ ] **Step 4: Implement `api/heat.js`**

```js
// ============================================================
// GET /api/heat?conversation_id=<uuid>
// Returns current prospect heat + narrative signals for the chat thermometer.
// ============================================================
import { createSupabaseAdmin } from "../lib/supabase.js";
import { authenticate } from "../lib/auth.js";
import { extract, deriveState } from "../lib/heat/narrativeSignals.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const convId = (req.query?.conversation_id || "").trim();
  if (!convId) {
    return res.status(400).json({ error: "conversation_id required" });
  }

  const authResult = await authenticate(req);
  if (!authResult.ok) {
    return res.status(401).json({ error: authResult.reason || "unauthorized" });
  }

  const sb = createSupabaseAdmin();

  // Access check — conversation must belong to a persona the caller can access.
  // The simplest correct check: the conversation exists and its persona is
  // accessible via the auth token. We reuse the conversation's access_code
  // column (see api/conversations.js for the pattern).
  const { data: conv, error: convErr } = await sb
    .from("conversations")
    .select("id, persona_id, access_code_id")
    .eq("id", convId)
    .maybeSingle();
  if (convErr || !conv) {
    return res.status(404).json({ error: "conversation_not_found" });
  }
  if (conv.access_code_id && conv.access_code_id !== authResult.accessCodeId) {
    return res.status(404).json({ error: "conversation_not_found" });
  }

  // Fetch all prospect_heat rows for this conversation (ordered by time)
  const { data: heatRows } = await sb
    .from("prospect_heat")
    .select("message_id, heat, delta, signals, created_at")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true });

  // Fetch the last 200 messages of the conversation (cap for signal extraction cost)
  const { data: messages } = await sb
    .from("messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", convId)
    .order("created_at", { ascending: true })
    .limit(200);

  // Normalize: messages.role in DB is "user"/"assistant", narrativeSignals expects "user"/"bot"
  const normalized = (messages || []).map(m => ({
    ...m,
    role: m.role === "assistant" ? "bot" : m.role,
  }));

  const { signals, total } = extract({
    messages: normalized,
    heatRows: heatRows || [],
    now: new Date(),
  });

  // Current heat = latest prospect_heat row
  const lastHeat = (heatRows && heatRows.length) ? heatRows[heatRows.length - 1] : null;
  const heat = lastHeat ? lastHeat.heat : null;
  const delta = lastHeat ? lastHeat.delta : null;
  const { state, direction } = deriveState(heat, delta);

  return res.status(200).json({
    current: { heat, delta, state, direction },
    signals,
    total_signals: total,
  });
}
```

**Important:** before writing, VERIFY by reading `api/conversations.js` that `authenticate` exists in `lib/auth.js` and that conversations have a queryable access-code column. If the project uses a different helper (e.g., `hasPersonaAccess`), use that instead. The exact call signatures should match the existing fidelity / conversations endpoints.

- [ ] **Step 5: Run tests to confirm pass**

Run: `npm test -- --test-name-pattern="GET /api/heat"`
Expected: PASS (at least the 400-case). Integration case only when env is set.

- [ ] **Step 6: Manual smoke test**

```bash
npm run dev
# In another terminal:
curl "http://localhost:5173/api/heat?conversation_id=<real-uuid>" -H "Authorization: Bearer <code>"
```

Expected: `{ current: {...}, signals: [...], total_signals: N }`.

- [ ] **Step 7: Commit**

```bash
git add api/heat.js test/api-heat.test.js
git commit -m "feat(api): GET /api/heat — current heat + narrative signals"
```

---

### Task 10: SSE `heat` event in `/api/chat`

**Files:**
- Modify: `api/chat.js`
- Modify: `src/lib/sse.js`

- [ ] **Step 1: Make `logProspectHeat` result awaitable in `api/chat.js`**

Locate the existing call (around line 282). Replace the fire-and-forget with an awaited variant + SSE emission. The code must remain resilient — a heat failure must not break the chat.

```js
// Old (line ~280-289):
const userMsg = inserted?.data?.find(m => m.role === "user");
if (userMsg) {
  const { logProspectHeat } = await import("../lib/heat/prospectHeat.js");
  logProspectHeat({
    messageId: userMsg.id,
    conversationId: convId,
    content: message,
    createdAt: userMsg.created_at,
  }).catch(() => {});
}

// New:
const userMsg = inserted?.data?.find(m => m.role === "user");
if (userMsg) {
  try {
    const { logProspectHeat } = await import("../lib/heat/prospectHeat.js");
    const heatResult = await logProspectHeat({
      messageId: userMsg.id,
      conversationId: convId,
      content: message,
      createdAt: userMsg.created_at,
    });
    if (heatResult) {
      // Recompute narrative signals for the SSE payload
      const { extract, deriveState } = await import("../lib/heat/narrativeSignals.js");
      const { data: allHeat } = await supabase
        .from("prospect_heat")
        .select("message_id, heat, delta, signals, created_at")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true });
      const { data: allMsgs } = await supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true })
        .limit(200);
      const normalized = (allMsgs || []).map(m => ({
        ...m,
        role: m.role === "assistant" ? "bot" : m.role,
      }));
      const { signals, total } = extract({
        messages: normalized,
        heatRows: allHeat || [],
        now: new Date(),
      });
      const newSignal = signals.find(s => s.message_id === userMsg.id) || null;
      const { state, direction } = deriveState(heatResult.heat, heatResult.delta);
      sse("heat", {
        current: { heat: heatResult.heat, delta: heatResult.delta, state, direction },
        new_signal: newSignal,
        total_signals: total,
      });
    }
  } catch (err) {
    // Heat computation failures must never break chat responses.
    console.log(JSON.stringify({
      event: "heat_emit_error", ts: new Date().toISOString(),
      conversation_id: convId, error: err?.message || "Unknown",
    }));
  }
}
```

- [ ] **Step 2: Extend client-side `streamChat` to dispatch `onHeat`**

Modify `src/lib/sse.js`:

```js
// Add to destructured callbacks:
const { onDelta, onThinking, onRewriting, onClear, onDone, onConversation, onError, onHeat } = callbacks;

// Add to switch statement:
case "heat": onHeat?.(evt); break;
```

- [ ] **Step 3: Manual end-to-end smoke test**

Run `npm run dev`, open the chat page, send a message, watch the Network tab. You should see a `data: {"type":"heat", "current": {...}, ...}` line in the SSE stream.

- [ ] **Step 4: Commit**

```bash
git add api/chat.js src/lib/sse.js
git commit -m "feat(chat): emit SSE heat event after logProspectHeat"
```

---

## Chunk 4: Thermomètre component + labo preview

### Task 11: Scaffold `HeatThermometer.svelte` with empty + loading states

**Files:**
- Create: `src/lib/components/HeatThermometer.svelte`
- Create: `src/routes/labo/heat/+page.svelte`

- [ ] **Step 1: Create the component with minimal markup**

Create `src/lib/components/HeatThermometer.svelte`:

```svelte
<script>
  import { authHeaders } from "$lib/api.js";

  /** @typedef {{heat: number|null, delta: number|null, state: string|null, direction: string|null}} Current */
  /** @typedef {{kind: string, label: string, quote: string, polarity: "pos"|"neg", delta: number, when: string, message_id: string|null}} Signal */

  let {
    conversationId = $bindable(null),
  } = $props();

  let current = $state(null);
  let signals = $state([]);
  let totalSignals = $state(0);
  let loading = $state(false);
  let error = $state(null);

  // Fetch on mount / on conversationId change
  $effect(() => {
    const id = conversationId;
    if (!id) {
      current = null;
      signals = [];
      totalSignals = 0;
      return;
    }
    loading = true;
    error = null;
    (async () => {
      try {
        const resp = await fetch(`/api/heat?conversation_id=${encodeURIComponent(id)}`, {
          headers: authHeaders(),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        current = data.current;
        signals = data.signals || [];
        totalSignals = data.total_signals || 0;
      } catch (e) {
        error = e.message;
      } finally {
        loading = false;
      }
    })();
  });

  /**
   * Update from an SSE `heat` event. Parent calls this.
   * @param {{current: Current, new_signal: Signal|null, total_signals: number}} payload
   */
  export function applyHeatEvent(payload) {
    if (payload.current) current = payload.current;
    if (payload.new_signal) {
      signals = [payload.new_signal, ...signals].slice(0, 8);
    }
    if (typeof payload.total_signals === "number") totalSignals = payload.total_signals;
  }

  // Derived display values
  let stateClass = $derived(
    current?.state === "glacé" || current?.state === "froid" ? "froid" :
    current?.state === "tiède" ? "tiede" :
    current?.state === "chaud" || current?.state === "brûlant" ? "chaud" :
    "neutral"
  );
  let stateLabel = $derived(
    current?.state && current?.direction
      ? `${current.state}, ${current.direction}`
      : "en attente"
  );
  let deltaClass = $derived(current?.delta == null ? "" : current.delta >= 0 ? "pos" : "neg");
  let deltaSign = $derived(current?.delta == null ? "" : current.delta >= 0 ? "▲ +" : "▼ ");
  let fillHeight = $derived(current?.heat != null ? Math.round(current.heat * 100) : 0);
</script>

<aside class="therm" aria-label="Thermomètre conversation">
  <header class="therm-head">
    <span class="therm-title mono">Thermomètre</span>
    <span class="therm-count mono">{totalSignals} signaux</span>
  </header>

  <div class="rail-wrap">
    <div class="rail" aria-hidden="true">
      <div class="rail-fill" style:height="{fillHeight}%"></div>
      <div class="rail-ticks mono">
        <span>1.0</span><span>.75</span><span>.50</span><span>.25</span><span>0</span>
      </div>
    </div>
    <div class="rail-data">
      <div class="rail-score mono">
        {#if current?.heat != null}
          {current.heat.toFixed(2)}<span class="unit">/1</span>
        {:else}
          —<span class="unit">/1</span>
        {/if}
      </div>
      <div class="rail-state {stateClass}">{stateLabel}</div>
      {#if current?.delta != null}
        <div class="rail-delta mono {deltaClass}">
          {deltaSign}{Math.abs(current.delta).toFixed(2)} ce msg
        </div>
      {/if}
    </div>
  </div>

  <section class="signals-block">
    <div class="signals-title mono">
      {#if signals.length === 0}
        aucun signal pour l'instant
      {:else}
        journal · {Math.min(signals.length, 8)} derniers
      {/if}
    </div>
    {#each signals as s (s.kind + s.when + (s.message_id || ""))}
      <div class="sig {s.polarity}">
        <div class="text">
          <strong>{s.label}</strong>
          <div class="quote">{s.quote}</div>
        </div>
        <div class="meta">
          <div class="when mono">{formatRelative(s.when)}</div>
          <div class="delta mono">{s.polarity === "pos" ? "+" : "−"}{s.delta.toFixed(2)}</div>
        </div>
      </div>
    {/each}
  </section>

  {#if error}
    <p class="err mono">Erreur : {error}</p>
  {/if}
</aside>

<script module>
  function formatRelative(iso) {
    const now = Date.now();
    const then = new Date(iso).getTime();
    const ms = now - then;
    const mins = Math.round(ms / 60000);
    if (mins < 1) return "à l'instant";
    if (mins < 60) return `il y a ${mins} min`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `il y a ${hours} h`;
    const days = Math.round(hours / 24);
    return `il y a ${days} j`;
  }
</script>

<style>
  .therm {
    padding: 18px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    background: var(--paper);
    font-family: var(--font-ui);
    font-size: 13.5px;
  }
  .mono { font-family: var(--font-mono); }
  .therm-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--rule);
  }
  .therm-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--ink-40); }
  .therm-count { font-size: 9.5px; color: var(--ink-30); }

  .rail-wrap { display: grid; grid-template-columns: auto 1fr; gap: 20px; align-items: stretch; padding: 4px 4px 4px 0; }
  .rail { position: relative; width: 3px; height: 210px; background: var(--ink-10); margin-left: 8px; }
  .rail-fill {
    position: absolute; left: -1px; right: -1px; bottom: 0; width: 5px;
    background: var(--ink);
    transition: height 0.6s cubic-bezier(.2,.8,.2,1);
  }
  .rail-ticks {
    position: absolute; right: -22px; top: 0; bottom: 0;
    display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end;
    font-size: 8.5px; color: var(--ink-30);
  }
  .rail-data { display: flex; flex-direction: column; padding-top: 4px; }
  .rail-score { font-size: 40px; color: var(--ink); line-height: 1; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
  .rail-score .unit { font-size: 14px; color: var(--ink-40); margin-left: 2px; }
  .rail-state { font-family: var(--font); font-size: 16px; font-style: italic; margin-top: 10px; }
  .rail-state.froid { color: var(--ink-40); }
  .rail-state.tiede { color: var(--warning); }
  .rail-state.chaud { color: var(--vermillon); }
  .rail-state.neutral { color: var(--ink-30); }
  .rail-delta { font-size: 10.5px; margin-top: 6px; font-variant-numeric: tabular-nums; }
  .rail-delta.pos { color: var(--success); }
  .rail-delta.neg { color: var(--vermillon); }

  .signals-block { display: flex; flex-direction: column; gap: 4px; }
  .signals-title {
    font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--ink-40);
    margin-bottom: 4px; padding-bottom: 8px; border-bottom: 1px solid var(--rule);
  }
  .sig {
    display: grid; grid-template-columns: 1fr auto; gap: 8px;
    padding: 8px 0; border-bottom: 1px dotted var(--rule);
    font-family: var(--font); font-size: 13px; align-items: baseline;
  }
  .sig .text strong { color: var(--ink); font-weight: 500; }
  .sig.pos .text strong::before { content: "▲ "; color: var(--success); font-size: 9.5px; }
  .sig.neg .text strong::before { content: "▼ "; color: var(--vermillon); font-size: 9.5px; }
  .sig .quote {
    color: var(--ink-40); font-style: italic; font-size: 12.5px; margin-top: 2px;
  }
  .sig .meta { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; white-space: nowrap; }
  .sig .when { font-size: 9px; color: var(--ink-30); text-transform: uppercase; letter-spacing: 0.04em; }
  .sig .delta { font-size: 11px; font-variant-numeric: tabular-nums; }
  .sig.pos .delta { color: var(--success); }
  .sig.neg .delta { color: var(--vermillon); }

  .err { color: var(--vermillon); font-size: 10px; margin-top: auto; }

  /* Mobile: hide rail, compact header row */
  @media (max-width: 768px) {
    .therm { padding: 8px 12px; gap: 6px; flex-direction: row; align-items: center; border-top: 1px solid var(--rule); }
    .therm-head { padding-bottom: 0; border-bottom: none; flex: 0 0 auto; }
    .rail-wrap { display: contents; }
    .rail { display: none; }
    .rail-data { flex-direction: row; align-items: baseline; gap: 10px; padding: 0; }
    .rail-score { font-size: 18px; }
    .rail-state { font-size: 13px; margin-top: 0; }
    .rail-delta { font-size: 10px; margin-top: 0; }
    .signals-block { display: none; } /* opens in a bottom sheet — implemented in Task 18 */
  }
</style>
```

- [ ] **Step 2: Create `/labo/heat` preview route**

Create `src/routes/labo/heat/+page.svelte`:

```svelte
<script>
  import HeatThermometer from "$lib/components/HeatThermometer.svelte";
  let ref = $state(null);

  const fixtures = {
    empty: { current: { heat: null, delta: null, state: null, direction: null }, signals: [], total_signals: 0 },
    tiede: {
      current: { heat: 0.55, delta: 0.08, state: "tiède", direction: "montant" },
      signals: [
        { kind: "positive_interest", label: "Verbalise intérêt", quote: "Intéressée par un échange avec toi.", polarity: "pos", delta: 0.08, when: new Date(Date.now() - 120000).toISOString(), message_id: "u1" },
        { kind: "question_back", label: "Pose une question en retour", quote: "Comment tu vois les choses ?", polarity: "pos", delta: 0.06, when: new Date(Date.now() - 300000).toISOString(), message_id: "u2" },
      ],
      total_signals: 5,
    },
    chaud: {
      current: { heat: 0.82, delta: 0.22, state: "chaud", direction: "montant" },
      signals: [
        { kind: "accept_call", label: "Accepte le call", quote: "Yes pas de soucis.", polarity: "pos", delta: 0.22, when: new Date().toISOString(), message_id: "u1" },
        { kind: "gives_email", label: "Donne son email", quote: "av…@gmail.com", polarity: "pos", delta: 0.15, when: new Date(Date.now() - 60000).toISOString(), message_id: "u2" },
        { kind: "relance_unanswered", label: "2 relances sans réponse", quote: "2 messages envoyés, pas de retour", polarity: "neg", delta: 0.08, when: new Date(Date.now() - 9 * 24 * 3600 * 1000).toISOString(), message_id: null },
      ],
      total_signals: 24,
    },
  };

  let selected = $state("chaud");

  $effect(() => {
    const f = fixtures[selected];
    if (ref && f) ref.applyHeatEvent({ current: f.current, new_signal: null, total_signals: f.total_signals });
    // We bypass the fetch effect by not setting conversationId
  });
</script>

<div class="labo">
  <nav>
    {#each Object.keys(fixtures) as k}
      <button class:active={selected === k} onclick={() => selected = k}>{k}</button>
    {/each}
  </nav>

  <div class="preview">
    <HeatThermometer bind:this={ref} />
  </div>
</div>

<style>
  .labo { display: grid; grid-template-columns: 200px 340px; gap: 24px; padding: 24px; min-height: 100dvh; }
  nav { display: flex; flex-direction: column; gap: 4px; }
  nav button {
    text-align: left; font-family: var(--font-mono); font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.1em;
    padding: 8px 12px; border: 1px solid var(--rule-strong); background: var(--paper);
    cursor: pointer;
  }
  nav button.active { background: var(--ink); color: var(--paper); }
  .preview { border: 1px solid var(--rule-strong); background: var(--paper); }
</style>
```

**Note:** the labo page pre-loads fixtures via `applyHeatEvent`, bypassing the fetch effect. In the real chat, `conversationId` triggers fetch.

- [ ] **Step 3: Run dev server + visual check**

Run: `npm run dev`. Open `http://localhost:5173/labo/heat`. Click through `empty` / `tiede` / `chaud`. Verify:
- Rail fill height matches score
- State label color: grey (froid/empty) / ochre (tiede) / vermillon (chaud)
- Signals render with correct ▲/▼ tick and delta color
- No layout jank on switch

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/HeatThermometer.svelte src/routes/labo/heat/+page.svelte
git commit -m "feat(ui): HeatThermometer component + /labo/heat preview route"
```

---

## Chunk 5: Chat page integration + marginalia toggle + mobile

### Task 12: Wire HeatThermometer into the chat page layout

**Files:**
- Modify: `src/routes/chat/[persona]/+page.svelte`

- [ ] **Step 1: Import + add state**

In the `<script>` block near existing imports:

```js
import HeatThermometer from "$lib/components/HeatThermometer.svelte";

let thermRef = $state(null);
```

- [ ] **Step 2: Add 2-column `.chat-body` wrapper + thermometer**

Replace the existing `.chat-messages` wrapper (and its siblings `ChatInput`, `AuditStrip`) with a new body structure:

```svelte
<div class="chat-body">
  <div class="chat-messages-col">
    <div class="chat-messages" bind:this={messagesEl}>
      {#each $messages as message (message.id)}
        <ChatMessage
          {message}
          seq={seqForMessage(message, $messages)}
          prevFidelity={prevFidelityFor(message, $messages)}
          {sourceStyle}
          onCorrect={handleCorrect}
          onValidate={handleValidate}
          onSaveRule={handleSaveRule}
          onCopyBlock={() => {}}
        />
      {/each}
      <div bind:this={scrollAnchor}></div>
    </div>
    <ChatInput onsend={handleSend} disabled={$sending} />
    <AuditStrip totals={sessionTotals} {sessionStart} />
  </div>

  <HeatThermometer bind:this={thermRef} conversationId={$currentConversationId} />
</div>
```

Add CSS to the `<style>` block:

```css
.chat-body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 300px;
  min-height: 0;
}
.chat-messages-col { display: flex; flex-direction: column; min-height: 0; }

@media (max-width: 1024px) {
  .chat-body { grid-template-columns: 1fr; }
  /* HeatThermometer's own mobile media query renders it as a compact bar */
}
```

- [ ] **Step 3: Wire the SSE `heat` event handler**

Locate `streamChat(...)` (around line 300). Add to the callbacks:

```js
onHeat(evt) {
  thermRef?.applyHeatEvent(evt);
},
```

- [ ] **Step 4: Manual smoke**

Run: `npm run dev`. Open a persona chat with an existing conversation that has at least one prospect message. Verify:
- The thermometer renders on the right
- Score + state + signals populate from `/api/heat`
- Sending a new user message updates the thermometer via SSE

- [ ] **Step 5: Commit**

```bash
git add src/routes/chat/[persona]/+page.svelte
git commit -m "feat(chat): wire HeatThermometer into chat page + SSE heat handler"
```

---

### Task 13: Move `MessageMarginalia` from right-column to toggle-below

**Files:**
- Modify: `src/lib/components/ChatMessage.svelte`
- Modify: `src/lib/components/MessageMarginalia.svelte`

- [ ] **Step 1: Read `ChatMessage.svelte` end-to-end**

Understand the existing grid layout (message column + marginalia column). Note the `narrow-only` media queries and existing `class:msg-row-bot` markup — we'll reuse the marginalia component wholesale.

- [ ] **Step 2: Add a toggle button + collapsable wrapper in `ChatMessage.svelte`**

For bot messages, replace the existing right-column `MessageMarginalia` render with:
1. A `⋯` button at the bottom-right of the message block (only for bot messages)
2. A collapsable `<section>` below the message that conditionally renders `MessageMarginalia`

Sketch:

```svelte
{#if message.role === "bot"}
  <button
    class="marg-toggle mono"
    aria-expanded={margOpen}
    aria-controls="marg-{message.id}"
    onclick={() => margOpen = !margOpen}
    title="Annotations labo"
  >
    {margOpen ? "×" : "⋯"}
  </button>
  {#if margOpen}
    <section id="marg-{message.id}" class="marg-inline">
      <MessageMarginalia
        {message}
        {stamp}
        {seq}
        {prevFidelity}
        {sourceStyle}
        bind:showDiff
      />
    </section>
  {/if}
{/if}
```

Define `let margOpen = $state(false);` near the top of the script block. Remove the right-column marginalia render + its grid container.

Adjust `.msg-row` CSS to collapse to a single column:

```css
.msg-row { display: flex; flex-direction: column; gap: 4px; }
.marg-toggle {
  align-self: flex-end;
  background: transparent; border: none; cursor: pointer;
  color: var(--ink-30); font-size: 12px; padding: 2px 6px;
  transition: color var(--dur-fast) var(--ease);
}
.marg-toggle:hover { color: var(--vermillon); }
.marg-inline {
  border-top: 1px dashed var(--rule);
  margin-top: 4px;
  padding-top: 6px;
}
```

- [ ] **Step 3: Adjust `MessageMarginalia.svelte` CSS for "below" orientation**

The existing `@media (max-width: 1024px)` block already handles a horizontal orientation. Promote that block out of the media query so it becomes the default (used by the new inline-below placement). Keep the vertical `.marg { border-left: … }` style only as a guarded fallback if ever reused elsewhere. Specifically:

- Move all rules currently inside `@media (max-width: 1024px) { … }` to top-level `.marg` styles.
- Delete the `border-left: 1px solid var(--rule-strong);` default.

This is a surgical CSS migration — don't rewrite the component logic.

- [ ] **Step 4: Manual verification**

Open the chat page:
- Each bot message has a `⋯` button at the bottom-right.
- Clicking expands an inline block below the message with fidelity, rules, style, timing.
- Closing hides it. No shift in the thermometer or surrounding messages.
- Keyboard: Tab focuses the button, Enter/Space toggles, `aria-expanded` flips.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/ChatMessage.svelte src/lib/components/MessageMarginalia.svelte
git commit -m "refactor(chat): marginalia moves from right column to below-message toggle"
```

---

### Task 14: Mobile — tap-to-expand signal sheet

**Files:**
- Modify: `src/lib/components/HeatThermometer.svelte`

- [ ] **Step 1: Add tap handler + bottom-sheet overlay**

At the top-level `<aside>` on mobile, make the header + compact row tappable to open a full-screen-ish bottom sheet with the signals journal:

```svelte
<script>
  let sheetOpen = $state(false);
  function toggleSheet() { sheetOpen = !sheetOpen; }
</script>

<aside class="therm" ...>
  <div class="therm-compact" role="button" tabindex="0" onclick={toggleSheet}
       onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") toggleSheet(); }}
       aria-expanded={sheetOpen} aria-controls="heat-sheet">
    <!-- existing header + rail-wrap go inside here -->
  </div>

  {#if sheetOpen}
    <div id="heat-sheet" class="sheet" role="dialog" aria-label="Journal des signaux">
      <button class="sheet-close mono" onclick={toggleSheet}>fermer</button>
      <!-- signals-block duplicated here, forced visible -->
    </div>
  {/if}
</aside>
```

CSS (mobile):

```css
@media (max-width: 768px) {
  .therm-compact { cursor: pointer; }
  .sheet {
    position: fixed; inset: auto 0 0 0;
    background: var(--paper);
    border-top: 1px solid var(--rule-strong);
    padding: 14px 16px 24px;
    max-height: 70vh; overflow-y: auto;
    z-index: 40;
  }
  .sheet-close {
    background: transparent; border: none; cursor: pointer;
    font-size: 10px; text-transform: uppercase; color: var(--ink-40);
    margin-bottom: 8px;
  }
  .sheet .signals-block { display: flex; }
}
```

- [ ] **Step 2: Manual mobile check**

Use the browser's responsive mode (e.g., 375×667). Verify:
- Thermometer is a compact horizontal row above the chat input
- Tapping opens the bottom sheet with the journal
- Fermer / Escape closes

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/HeatThermometer.svelte
git commit -m "feat(ui): mobile HeatThermometer — compact bar + bottom-sheet journal"
```

---

### Task 15: Regression sweep — existing tests + snapshot fixtures

**Files:**
- Possibly modify: `test/` entries that assert on `ChatMessage`/`MessageMarginalia` layout

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected outcome: all backend tests green. If any UI-snapshot or DOM-structure tests exist that asserted on `MessageMarginalia` being in the right column, they'll fail. Fix them to reflect the new placement.

If no tests fail, good — nothing to update.

- [ ] **Step 2: Manual regression checklist**

- Switching conversations (ConversationSidebar) clears + re-fetches thermometer
- SSE `done` event followed by `heat` event updates in sequence
- Budget/rate-limit error paths don't leak a stuck loading state
- `/labo/heat` still works

- [ ] **Step 3: Commit (empty if no changes)**

```bash
# If there were fixes:
git add <updated-test-files>
git commit -m "test: update marginalia layout assertions for inline-below placement"
# If not, skip this step.
```

---

## Summary of deliverables

At the end of this plan:

- ✅ New pure extractor `lib/heat/narrativeSignals.js` with 10 signal kinds, unit-tested against 10 real-conversation fixtures
- ✅ New GET `/api/heat` endpoint returning `{ current, signals, total_signals }`
- ✅ SSE `heat` event emission in `/api/chat` after every `logProspectHeat`
- ✅ New `HeatThermometer.svelte` component (desktop rail + mobile compact bar + bottom sheet)
- ✅ `/labo/heat` preview route for visual QA
- ✅ Chat page right column replaced by thermometer
- ✅ `MessageMarginalia` moved to a per-message toggle block below each bot message
- ✅ Mobile layout (compact bar above input + tap-to-expand sheet)

**Out of scope (per spec non-goals):** manager dashboard, LLM-based signal generation, automatic CTA, heat sparkline, ETA-to-RDV prediction, historical backfill job.

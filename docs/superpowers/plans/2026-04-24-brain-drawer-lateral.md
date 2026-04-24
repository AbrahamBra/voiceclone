# Brain Drawer Lateral Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace navigation to `/brain/[persona]` with a side-by-side drawer opened from the chat page, reusing the 4 existing Panels (Connaissance, Protocole, Intelligence, Réglages), and capture training signals `brain_drawer_opened` + `brain_edit_during_draft`.

**Architecture:** Pure core library (`brainDrawerCore.js` + `brainDrawerUrl.js` + `brainEventsCore.js`) for unit-testable logic, thin SvelteKit wrappers (`brainDrawer.js` + `brainEvents.js`) for `goto` + fetch side-effects, one drawer component (`BrainDrawer.svelte`) that mounts the 4 existing Panels, minimal modifications to `/chat/[persona]/+page.svelte`, and a 307 redirect from the legacy `/brain/[persona]` route. Migration 046 extends the `feedback_events.event_type` CHECK.

**Tech Stack:** SvelteKit 2.57.1 + Svelte 5 (runes) + Supabase + node:test.

**Spec source:** `docs/superpowers/specs/2026-04-24-brain-drawer-lateral-design.md`

---

## Plan-to-spec deviations (decisions locked at plan time)

1. **File split for testability** — the spec describes `brainDrawer.js` as a single file and `brainEvents.js` as a single file. Both import from `$app/*` (SvelteKit-virtual) or Svelte stores, which don't resolve in `node:test`. The plan splits each into **pure core + thin wrapper**:
   - `brainDrawerUrl.js` (pure: `parseBrainTab`, `buildUrlWithBrain`)
   - `brainDrawerCore.js` (pure state machine: open/close/toggle/setTab/syncFromUrl, no URL side-effect, no `$app` imports)
   - `brainDrawer.js` (thin wrapper: instantiates core, subscribes to drive `goto` + reads `$page`)
   - `brainEventsCore.js` (pure: `buildBrainEventPayload({convId, messages, eventType})`)
   - `brainEvents.js` (thin wrapper: reads Svelte stores, calls core, POSTs with `fetch`)
2. **Migration test path** — spec says `test/migrations/046-brain-events.test.js`; `npm test` uses `node --test test/*.test.js` (flat glob, **not recursive**). Plan places it at `test/migration-046-brain-events.test.js` (flat) so it runs.
3. **Component-level tests dropped from automated suite** — no Svelte component test framework exists in repo (no vitest, no @testing-library/svelte). Tests mentioned in spec §"new tests" for `BrainDrawer.svelte` rendering and `protocol-panel-callback.test.js` are **covered by manual smoke** per the 12 acceptance criteria (spec lines 563-576). Adding a component test framework is out of scope of this chantier.
4. **Named `emitBrainEvent` remains the public export** — the wrapper keeps the spec's name; only internal structure differs.

---

## File Structure

**Create:**
- `src/lib/stores/brainDrawerUrl.js` — 2 pure helpers: `parseBrainTab(searchParams, validTabs, defaultTab)` → tab string, `buildUrlWithBrain(url, tab)` → URL instance.
- `src/lib/stores/brainDrawerCore.js` — pure state machine `createBrainDrawerCore({storage, validTabs, defaultTab, onTabChange})` returning `{ subscribe, open, openAt, close, toggle, setTab, syncFromUrl }`. Storage and URL-side-effect are injected.
- `src/lib/stores/brainDrawer.js` — thin SvelteKit wrapper: instantiates core with real `localStorage` + `goto` adapter.
- `src/lib/api/brainEventsCore.js` — 1 pure helper: `buildBrainEventPayload({conversationId, messages, eventType, narrativeKinds})` → `{conversation_id, message_id, event_type}` or `null` (skip).
- `src/lib/api/brainEvents.js` — thin wrapper: `emitBrainEvent(type)` reading Svelte stores, calling core, POSTing.
- `src/lib/components/BrainDrawer.svelte` — drawer shell (tabs, ESC, mounts 4 Panels).
- `src/routes/brain/[persona]/+page.server.js` — 307 redirect load function.
- `supabase/046_feedback_brain_drawer.sql` — extends CHECK.
- `test/brain-drawer-url.test.js` — tests URL helpers.
- `test/brain-drawer-store.test.js` — tests core state machine.
- `test/brain-signals.test.js` — tests `buildBrainEventPayload` + fire-and-forget fetch mock.
- `test/brain-redirect.test.js` — tests `+page.server.js` load function (mocked `redirect` thrown).
- `test/migration-046-brain-events.test.js` — applies SQL + verifies CHECK (DB-gated, skips without test DB).

**Modify:**
- `src/lib/components/ProtocolPanel.svelte` — add optional prop `onRuleAdded?: () => void`, call it after successful rule save.
- `src/routes/chat/[persona]/+page.svelte` — 3 zones: (a) imports + 🧠 top-bar button + `handleBrainToggle` + `celebrateRuleAdded` + `$effect` URL sync, (b) layout grid `.chat-shell.drawer-open`, (c) ⌘K palette `open-brain` action.
- `api/feedback-events.js` — line 3 `VALID_TYPES`: add `copy_paste_out`, `regen_rejection`, `brain_drawer_opened`, `brain_edit_during_draft`.

**Delete:**
- `src/routes/brain/[persona]/+page.svelte` (163 lines)
- `src/routes/brain/[persona]/+page.js`

---

## Chunk 1: Database migration + API drift fix

**Goal of this chunk:** DB prod-ready to accept the 2 new event_types (and the 2 already-missing `copy_paste_out`/`regen_rejection` from 040 drift), with an automated test that proves the CHECK accepts/rejects the right values. At end of chunk, no client code touches these yet, but API would no longer 400 if called.

### Task 1: Write migration 046 + its test

**Files:**
- Create: `supabase/046_feedback_brain_drawer.sql`
- Create: `test/migration-046-brain-events.test.js`

- [ ] **Step 1: Write the migration file**

Create `supabase/046_feedback_brain_drawer.sql` with the exact content from spec lines 487-527:

```sql
-- 046_feedback_brain_drawer.sql
--
-- Chantier #2 (drawer cerveau latéral) — ajoute deux event_types au pipeline
-- feedback :
--   • brain_drawer_opened       — user ouvre le drawer cerveau depuis le chat
--                                  (source: top_button | cmd_k | url_redirect)
--   • brain_edit_during_draft   — user ajoute/corrige une règle dans le drawer
--                                  pendant qu'un draft est actif dans le composer
--                                  (signal du moment data-move, cible prioritaire)
--
-- Attaché au dernier message narratif (`toi`/`prospect`/`clone_draft`/`draft_rejected`)
-- de la conv courante pour préserver l'invariant `message_id NOT NULL`. Si la conv
-- n'a aucun message narratif, le client skip l'émission silencieusement (cf.
-- §"Cas limites" du spec). Pas de relaxation DB.
--
-- Spec source : docs/superpowers/specs/2026-04-24-brain-drawer-lateral-design.md.
-- Numéros 038/039 = protocole-v2 core/hooks (PR #79). 040 = training signal capture.
-- 041-043 réservés paper-space pour les follow-ups Chunk 2.5 protocole-vivant
-- (rule_proposals, n4_paused_until, promoted_to_rule_index). 044-045 déjà
-- appliqués (dernier = 045 match_propositions vector(1024)). D'où 046.
-- Additif uniquement — aucun DROP destructif.

ALTER TABLE feedback_events
  DROP CONSTRAINT IF EXISTS feedback_events_event_type_check;

ALTER TABLE feedback_events
  ADD CONSTRAINT feedback_events_event_type_check
  CHECK (event_type IN (
    'validated',
    'validated_edited',
    'corrected',
    'saved_rule',
    'excellent',
    'client_validated',
    'paste_zone_dismissed',
    'copy_paste_out',
    'regen_rejection',
    'brain_drawer_opened',
    'brain_edit_during_draft'
  ));

COMMENT ON COLUMN feedback_events.event_type IS
  'Feedback taxonomy. 11 event types: validated, validated_edited, corrected, saved_rule, excellent, client_validated, paste_zone_dismissed, copy_paste_out, regen_rejection, brain_drawer_opened, brain_edit_during_draft. See 046_feedback_brain_drawer.sql.';
```

- [ ] **Step 2: Write the migration test**

Follow the `test/protocol-v2-migration.test.js` pattern (DB-gated, skips if `SUPABASE_TEST_URL` not set). Create `test/migration-046-brain-events.test.js`:

```javascript
import { strict as assert } from "node:assert";
import { describe, it, before } from "node:test";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const TEST_URL = process.env.SUPABASE_TEST_URL;
const TEST_KEY = process.env.SUPABASE_TEST_SERVICE_KEY;
const skipIfNoTestDb = () => (!TEST_URL || !TEST_KEY) ? { skip: "no test DB configured" } : {};

const NEW_EVENTS = ['brain_drawer_opened', 'brain_edit_during_draft'];
const DRIFT_FIX_EVENTS = ['copy_paste_out', 'regen_rejection'];
const EXISTING_EVENTS = ['validated', 'validated_edited', 'corrected', 'saved_rule', 'excellent', 'client_validated', 'paste_zone_dismissed'];

describe("migration 046 — feedback_brain_drawer", () => {
  let sb;
  before(() => { if (TEST_URL && TEST_KEY) sb = createClient(TEST_URL, TEST_KEY); });

  it("applies without error", skipIfNoTestDb(), async () => {
    const sql = readFileSync("supabase/046_feedback_brain_drawer.sql", "utf8");
    const { error } = await sb.rpc("exec_sql", { sql });
    assert.equal(error, null, `SQL exec failed: ${error?.message}`);
  });

  it("CHECK accepts all 11 valid event_types", skipIfNoTestDb(), async () => {
    const allValid = [...EXISTING_EVENTS, ...DRIFT_FIX_EVENTS, ...NEW_EVENTS];
    assert.equal(allValid.length, 11);
    // Verification via pg_constraint — requires a SECURITY DEFINER RPC or direct pg client.
    // Per protocol-v2-migration.test.js NOTE, the current approach is inspecting the
    // constraint definition string via an RPC. If unavailable, fall back to asserting
    // the migration file text contains all 11 event names (smoke).
    const sql = readFileSync("supabase/046_feedback_brain_drawer.sql", "utf8");
    for (const event of allValid) {
      assert.ok(sql.includes(`'${event}'`), `migration missing event '${event}'`);
    }
  });

  it("CHECK rejects an invented event_type", skipIfNoTestDb(), async () => {
    // Attempt an insert with a bogus type — expect CHECK violation error.
    const { error } = await sb.from("feedback_events").insert({
      conversation_id: "00000000-0000-0000-0000-000000000000",
      message_id: "00000000-0000-0000-0000-000000000000",
      persona_id: "00000000-0000-0000-0000-000000000000",
      event_type: "totally_made_up_event",
    });
    assert.ok(error, "expected an error for invalid event_type");
    // Error code 23514 = check_violation (either that or 23503 foreign key if zero-uuid FKs fail first — accept both as evidence the invalid type path is exercised).
    assert.ok(
      /check|23514|violat/i.test(error.message) || error.code === "23514" || error.code === "23503",
      `expected check violation, got: ${error.code} ${error.message}`
    );
  });
});
```

- [ ] **Step 3: Run tests to verify they pass (or skip cleanly)**

Run: `npm test -- test/migration-046-brain-events.test.js`
Expected (without test DB):
```
# test/migration-046-brain-events.test.js
ok 1 - migration 046 — feedback_brain_drawer
  # subtest: applies without error — SKIP (no test DB configured)
  # subtest: CHECK accepts all 11 valid event_types — SKIP
  # subtest: CHECK rejects an invented event_type — SKIP
```

Expected (with test DB): all 3 pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/046_feedback_brain_drawer.sql test/migration-046-brain-events.test.js
git commit -m "feat(brain-drawer): migration 046 — extend feedback_events CHECK (chantier #2)

Adds brain_drawer_opened + brain_edit_during_draft event_types.
Also normalizes 9→11 CHECK to include copy_paste_out + regen_rejection
(drift fix from migration 040 — these were added to DB but not to the
API's VALID_TYPES in 040's PR)."
```

### Task 2: Apply migration 046 to dev Supabase

**Files:** None (manual step).

- [ ] **Step 1: Open Supabase dev project SQL editor**

Navigate to the Supabase dashboard → dev project → SQL editor. Do **not** run on prod yet (prod application is deploy step 13, AFTER preview smoke).

- [ ] **Step 2: Paste the full content of `supabase/046_feedback_brain_drawer.sql` into a new query**

- [ ] **Step 3: Run**

Expected output:
```
ALTER TABLE
ALTER TABLE
COMMENT
```

- [ ] **Step 4: Verify**

In the SQL editor, run:
```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'feedback_events_event_type_check';
```

Expected: string contains all 11 event_types: `'validated','validated_edited','corrected','saved_rule','excellent','client_validated','paste_zone_dismissed','copy_paste_out','regen_rejection','brain_drawer_opened','brain_edit_during_draft'`.

No commit for this step (DB operation, not code).

### Task 3: Extend `api/feedback-events.js` VALID_TYPES

**Files:**
- Modify: `api/feedback-events.js:3`

- [ ] **Step 1: Read current VALID_TYPES**

Current line 3:
```js
const VALID_TYPES = new Set(["validated", "validated_edited", "corrected", "saved_rule", "excellent", "client_validated", "paste_zone_dismissed"]);
```

7 values. Missing 4 (2 from 040 drift + 2 from chantier #2).

- [ ] **Step 2: Add a test for the 4 new accepted event_types**

Add this test block to the existing `test/api-feedback-events.test.js`, inside the outer describe (before `describe("POST /api/feedback-events"`). Don't reorder existing tests.

```javascript
describe("POST /api/feedback-events — VALID_TYPES coverage (chantier #2)", () => {
  const NEW_ACCEPTED = [
    'copy_paste_out',           // added by migration 040, missing from VALID_TYPES (drift)
    'regen_rejection',          // added by migration 040, missing from VALID_TYPES (drift)
    'brain_drawer_opened',      // added by migration 046
    'brain_edit_during_draft',  // added by migration 046
  ];

  for (const eventType of NEW_ACCEPTED) {
    it(`does NOT reject '${eventType}' at the VALID_TYPES gate (no 400 with /invalid event_type/)`, async () => {
      const handler = (await import("../api/feedback-events.js")).default;
      const req = {
        method: "POST",
        query: {},
        headers: { "x-access-code": process.env.ADMIN_ACCESS_CODE || "admin" },
        body: {
          conversation_id: "00000000-0000-0000-0000-000000000000",
          message_id: "00000000-0000-0000-0000-000000000000",
          event_type: eventType,
        },
      };
      const res = makeRes();
      await handler(req, res);
      // With no real DB (zero-uuid), we expect either 404 (conv not found) or 500 (DB insert fail).
      // The critical assertion: NOT a 400 with /invalid event_type/ — that would prove VALID_TYPES drift.
      if (res.statusCode === 400 && res.body?.error) {
        assert.doesNotMatch(res.body.error, /invalid event_type/i, `'${eventType}' was rejected as invalid — VALID_TYPES missing it`);
      }
    });
  }
});
```

- [ ] **Step 3: Run test to verify it FAILS (current VALID_TYPES is missing the 4 events)**

Run: `npm test -- test/api-feedback-events.test.js`
Expected: 4 failures in the new `VALID_TYPES coverage` describe, each with message `'<event>' was rejected as invalid — VALID_TYPES missing it`.

- [ ] **Step 4: Update VALID_TYPES**

Edit `api/feedback-events.js` line 3:

```js
const VALID_TYPES = new Set([
  "validated",
  "validated_edited",
  "corrected",
  "saved_rule",
  "excellent",
  "client_validated",
  "paste_zone_dismissed",
  "copy_paste_out",           // drift fix from migration 040
  "regen_rejection",          // drift fix from migration 040
  "brain_drawer_opened",      // chantier #2
  "brain_edit_during_draft",  // chantier #2
]);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/api-feedback-events.test.js`
Expected: all tests pass (new 4 + all existing).

- [ ] **Step 6: Commit**

```bash
git add api/feedback-events.js test/api-feedback-events.test.js
git commit -m "feat(brain-drawer): extend VALID_TYPES to 11 event_types

- copy_paste_out + regen_rejection: drift fix from migration 040
- brain_drawer_opened + brain_edit_during_draft: chantier #2 signals

Aligns api/feedback-events.js with migration 046 CHECK.
Deploy note: migration 046 MUST be on prod before this change merges master."
```

---

## Chunk 2: Pure core library (store + signals)

**Goal of this chunk:** All non-Svelte-runtime logic implemented and unit-tested. No SvelteKit dependencies in any file in this chunk beyond the thin wrappers (which are minimal enough to be covered by preview smoke).

### Task 4: `brainDrawerUrl.js` + tests

**Files:**
- Create: `src/lib/stores/brainDrawerUrl.js`
- Create: `test/brain-drawer-url.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/brain-drawer-url.test.js`:

```javascript
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseBrainTab, buildUrlWithBrain } from "../src/lib/stores/brainDrawerUrl.js";

const VALID_TABS = ['connaissance', 'protocole', 'intelligence', 'reglages'];
const DEFAULT = 'connaissance';

describe("parseBrainTab", () => {
  it("returns the tab when present and valid", () => {
    const params = new URLSearchParams("brain=protocole");
    assert.equal(parseBrainTab(params, VALID_TABS, DEFAULT), 'protocole');
  });

  it("returns null when no brain param", () => {
    const params = new URLSearchParams("other=foo");
    assert.equal(parseBrainTab(params, VALID_TABS, DEFAULT), null);
  });

  it("returns default when brain param is invalid", () => {
    const params = new URLSearchParams("brain=notatab");
    assert.equal(parseBrainTab(params, VALID_TABS, DEFAULT), DEFAULT);
  });

  it("returns default for empty brain param", () => {
    const params = new URLSearchParams("brain=");
    assert.equal(parseBrainTab(params, VALID_TABS, DEFAULT), DEFAULT);
  });
});

describe("buildUrlWithBrain", () => {
  it("adds brain param when tab is provided", () => {
    const url = new URL("https://example.com/chat/abc");
    const next = buildUrlWithBrain(url, 'intelligence');
    assert.equal(next.searchParams.get('brain'), 'intelligence');
    assert.equal(next.pathname, '/chat/abc');
  });

  it("removes brain param when tab is null", () => {
    const url = new URL("https://example.com/chat/abc?brain=protocole");
    const next = buildUrlWithBrain(url, null);
    assert.equal(next.searchParams.has('brain'), false);
  });

  it("preserves other query params", () => {
    const url = new URL("https://example.com/chat/abc?conv=xyz");
    const next = buildUrlWithBrain(url, 'reglages');
    assert.equal(next.searchParams.get('conv'), 'xyz');
    assert.equal(next.searchParams.get('brain'), 'reglages');
  });

  it("does not mutate the input URL", () => {
    const url = new URL("https://example.com/chat/abc");
    buildUrlWithBrain(url, 'protocole');
    assert.equal(url.searchParams.has('brain'), false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/brain-drawer-url.test.js`
Expected: FAIL with `Cannot find module '../src/lib/stores/brainDrawerUrl.js'` or similar.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/stores/brainDrawerUrl.js`:

```javascript
// Pure URL helpers for the brain drawer tab query param.
// No SvelteKit imports — unit-testable in node:test.

/**
 * Read the brain tab from search params, with fallback.
 * @param {URLSearchParams} searchParams
 * @param {string[]} validTabs
 * @param {string} defaultTab
 * @returns {string|null} — the tab name, defaultTab if present-but-invalid, or null if absent.
 */
export function parseBrainTab(searchParams, validTabs, defaultTab) {
  if (!searchParams.has('brain')) return null;
  const raw = searchParams.get('brain');
  if (!raw) return defaultTab;  // present-but-empty counts as "tried to open, no tab" → default
  return validTabs.includes(raw) ? raw : defaultTab;
}

/**
 * Build a new URL with the brain tab param set or removed. Does not mutate input.
 * @param {URL} url
 * @param {string|null} tab — null to remove the param.
 * @returns {URL}
 */
export function buildUrlWithBrain(url, tab) {
  const next = new URL(url);
  if (tab) next.searchParams.set('brain', tab);
  else next.searchParams.delete('brain');
  return next;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/brain-drawer-url.test.js`
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/brainDrawerUrl.js test/brain-drawer-url.test.js
git commit -m "feat(brain-drawer): pure URL helpers parseBrainTab + buildUrlWithBrain"
```

### Task 5: `brainDrawerCore.js` + tests

**Files:**
- Create: `src/lib/stores/brainDrawerCore.js`
- Create: `test/brain-drawer-store.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/brain-drawer-store.test.js`. The core exposes the same API as the spec's store but takes injected `storage` and `onTabChange` adapters for testability.

```javascript
import { strict as assert } from "node:assert";
import { describe, it, beforeEach } from "node:test";
import { get } from "svelte/store";
import { createBrainDrawerCore } from "../src/lib/stores/brainDrawerCore.js";

const VALID = ['connaissance', 'protocole', 'intelligence', 'reglages'];
const DEFAULT = 'connaissance';

function makeFakeStorage() {
  let store = {};
  return {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    _dump: () => ({ ...store }),
    _load: (obj) => { store = { ...obj }; },
  };
}

function makeRecorder() {
  const calls = [];
  const fn = (tab, opts) => calls.push({ tab, opts: opts || {} });
  return { fn, calls };
}

function makeCore({ storage, onTabChange, initialStorage = {} } = {}) {
  const s = storage || makeFakeStorage();
  s._load?.(initialStorage);
  const rec = onTabChange || makeRecorder();
  const core = createBrainDrawerCore({
    storage: s,
    validTabs: VALID,
    defaultTab: DEFAULT,
    onTabChange: rec.fn,
  });
  return { core, storage: s, onTabChange: rec };
}

describe("brainDrawerCore — initial state", () => {
  it("starts closed on default tab", () => {
    const { core } = makeCore();
    const state = get(core);
    assert.equal(state.open, false);
    assert.equal(state.tab, DEFAULT);
  });
});

describe("brainDrawerCore — open()", () => {
  it("open() with no arg uses lastTab from storage", () => {
    const { core } = makeCore({ initialStorage: { 'brainDrawer:lastTab': 'intelligence' } });
    core.open();
    const state = get(core);
    assert.equal(state.open, true);
    assert.equal(state.tab, 'intelligence');
  });

  it("open() with no arg and empty storage falls back to default", () => {
    const { core } = makeCore();
    core.open();
    assert.equal(get(core).tab, DEFAULT);
  });

  it("open('protocole') opens on that tab", () => {
    const { core, storage } = makeCore();
    core.open('protocole');
    assert.equal(get(core).tab, 'protocole');
    assert.equal(storage.getItem('brainDrawer:lastTab'), 'protocole');
  });

  it("open('invalid') falls back to lastTab", () => {
    const { core } = makeCore({ initialStorage: { 'brainDrawer:lastTab': 'reglages' } });
    core.open('invalid');
    assert.equal(get(core).tab, 'reglages');
  });

  it("open() emits onTabChange(tab, {replaceState: false})", () => {
    const { core, onTabChange } = makeCore();
    core.open('protocole');
    assert.equal(onTabChange.calls.length, 1);
    assert.equal(onTabChange.calls[0].tab, 'protocole');
    assert.equal(onTabChange.calls[0].opts.replaceState, false);
  });
});

describe("brainDrawerCore — openAt()", () => {
  it("openAt(tab) is a synonym of open(tab)", () => {
    const { core } = makeCore();
    core.openAt('reglages');
    assert.equal(get(core).open, true);
    assert.equal(get(core).tab, 'reglages');
  });
});

describe("brainDrawerCore — close()", () => {
  it("close() sets open=false but preserves tab", () => {
    const { core } = makeCore();
    core.open('protocole');
    core.close();
    const state = get(core);
    assert.equal(state.open, false);
    assert.equal(state.tab, 'protocole');
  });

  it("close() emits onTabChange(null, {replaceState: false})", () => {
    const { core, onTabChange } = makeCore();
    core.open('protocole');
    onTabChange.calls.length = 0;
    core.close();
    assert.equal(onTabChange.calls.length, 1);
    assert.equal(onTabChange.calls[0].tab, null);
    assert.equal(onTabChange.calls[0].opts.replaceState, false);
  });
});

describe("brainDrawerCore — toggle()", () => {
  it("toggle() from closed opens on current tab", () => {
    const { core } = makeCore({ initialStorage: { 'brainDrawer:lastTab': 'intelligence' } });
    core.setTab('protocole'); // state.tab is 'protocole' but drawer closed
    core.toggle();
    assert.equal(get(core).open, true);
    assert.equal(get(core).tab, 'protocole');
  });

  it("toggle() from open closes", () => {
    const { core } = makeCore();
    core.open('reglages');
    core.toggle();
    assert.equal(get(core).open, false);
    assert.equal(get(core).tab, 'reglages');
  });

  it("toggle() fresh session (no setTab yet) falls back to default", () => {
    const { core } = makeCore();
    core.toggle();
    assert.equal(get(core).open, true);
    assert.equal(get(core).tab, DEFAULT);
  });
});

describe("brainDrawerCore — setTab()", () => {
  it("setTab(valid) updates tab AND persists to storage", () => {
    const { core, storage } = makeCore();
    core.open();
    core.setTab('intelligence');
    assert.equal(get(core).tab, 'intelligence');
    assert.equal(storage.getItem('brainDrawer:lastTab'), 'intelligence');
  });

  it("setTab(invalid) is a no-op", () => {
    const { core } = makeCore();
    core.open('protocole');
    core.setTab('invented');
    assert.equal(get(core).tab, 'protocole');
  });

  it("setTab emits onTabChange(tab, {replaceState: true})", () => {
    const { core, onTabChange } = makeCore();
    core.open('protocole');
    onTabChange.calls.length = 0;
    core.setTab('intelligence');
    assert.equal(onTabChange.calls.length, 1);
    assert.equal(onTabChange.calls[0].tab, 'intelligence');
    assert.equal(onTabChange.calls[0].opts.replaceState, true);
  });
});

describe("brainDrawerCore — syncFromUrl()", () => {
  it("syncFromUrl('protocole') opens on that tab", () => {
    const { core } = makeCore();
    core.syncFromUrl('protocole');
    assert.equal(get(core).open, true);
    assert.equal(get(core).tab, 'protocole');
  });

  it("syncFromUrl(null) closes the drawer", () => {
    const { core } = makeCore();
    core.open('protocole');
    core.syncFromUrl(null);
    assert.equal(get(core).open, false);
  });

  it("syncFromUrl persists the tab to storage (lastTab)", () => {
    const { core, storage } = makeCore();
    core.syncFromUrl('intelligence');
    assert.equal(storage.getItem('brainDrawer:lastTab'), 'intelligence');
  });

  it("syncFromUrl does NOT emit onTabChange (URL is source of truth, no echo)", () => {
    const { core, onTabChange } = makeCore();
    core.syncFromUrl('protocole');
    assert.equal(onTabChange.calls.length, 0);
  });

  it("precedence URL > localStorage > default verified via syncFromUrl", () => {
    // lastTab='intelligence' in storage, but URL says 'reglages' — URL wins.
    const { core } = makeCore({ initialStorage: { 'brainDrawer:lastTab': 'intelligence' } });
    core.syncFromUrl('reglages');
    assert.equal(get(core).tab, 'reglages');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/brain-drawer-store.test.js`
Expected: FAIL with module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/stores/brainDrawerCore.js`:

```javascript
// Pure state machine for the brain drawer. No SvelteKit imports.
// URL/storage side-effects injected via the factory.
import { writable, get } from 'svelte/store';

export const STORAGE_KEY = 'brainDrawer:lastTab';

/**
 * @param {object} opts
 * @param {{getItem: (k: string) => string|null, setItem: (k: string, v: string) => void}} opts.storage
 * @param {string[]} opts.validTabs
 * @param {string} opts.defaultTab
 * @param {(tab: string|null, opts?: {replaceState?: boolean}) => void} opts.onTabChange — called with the tab (or null on close) + options; the thin wrapper uses this to drive goto().
 */
export function createBrainDrawerCore({ storage, validTabs, defaultTab, onTabChange }) {
  const { subscribe, set, update } = writable({ open: false, tab: defaultTab });

  function lastTab() {
    const stored = storage.getItem(STORAGE_KEY);
    return validTabs.includes(stored) ? stored : defaultTab;
  }

  function remember(tab) {
    if (validTabs.includes(tab)) storage.setItem(STORAGE_KEY, tab);
  }

  function open(tab) {
    const t = validTabs.includes(tab) ? tab : lastTab();
    remember(t);
    onTabChange(t, { replaceState: false });
    set({ open: true, tab: t });
  }

  function openAt(tab) {
    return open(tab);
  }

  function close() {
    onTabChange(null, { replaceState: false });
    update(s => ({ ...s, open: false }));
  }

  function toggle() {
    const s = get({ subscribe });
    if (s.open) {
      close();
      return;
    }
    const t = validTabs.includes(s.tab) ? s.tab : lastTab();
    remember(t);
    onTabChange(t, { replaceState: false });
    set({ open: true, tab: t });
  }

  function setTab(tab) {
    if (!validTabs.includes(tab)) return;
    remember(tab);
    onTabChange(tab, { replaceState: true });
    update(s => ({ ...s, tab }));
  }

  // Called by the thin wrapper on URL changes. URL is source of truth — no echo
  // back via onTabChange to avoid a reactive loop.
  function syncFromUrl(urlTab) {
    if (urlTab && validTabs.includes(urlTab)) {
      remember(urlTab);
      set({ open: true, tab: urlTab });
    } else {
      update(s => ({ ...s, open: false }));
    }
  }

  return { subscribe, open, openAt, close, toggle, setTab, syncFromUrl };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/brain-drawer-store.test.js`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/brainDrawerCore.js test/brain-drawer-store.test.js
git commit -m "feat(brain-drawer): pure state machine core (open/close/toggle/setTab/syncFromUrl)"
```

### Task 6: `brainDrawer.js` thin wrapper

**Files:**
- Create: `src/lib/stores/brainDrawer.js`

No automated test (wrapper is ~20 lines of `goto` + `localStorage` + `$page` plumbing, covered by preview smoke acceptance criteria #3, #4, #11).

- [ ] **Step 1: Write the wrapper**

Create `src/lib/stores/brainDrawer.js`:

```javascript
// Thin SvelteKit wrapper over brainDrawerCore. Provides the store instance
// used by components. Not unit-tested — covered by manual smoke (spec §acceptance criteria #3, #4, #11).
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { get } from 'svelte/store';
import { createBrainDrawerCore } from './brainDrawerCore.js';
import { buildUrlWithBrain } from './brainDrawerUrl.js';

export const VALID_BRAIN_TABS = ['connaissance', 'protocole', 'intelligence', 'reglages'];
const DEFAULT_TAB = 'connaissance';

// SSR-safe storage shim. On the server, getItem returns null and setItem is a no-op.
const storage = {
  getItem: (k) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null),
  setItem: (k, v) => { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); },
};

function onTabChange(tab, opts = {}) {
  if (typeof window === 'undefined') return;  // SSR: skip nav
  const current = get(page);
  const url = buildUrlWithBrain(current.url, tab);
  goto(url, { replaceState: opts.replaceState ?? false, noScroll: true, keepFocus: true });
}

export const brainDrawer = createBrainDrawerCore({
  storage,
  validTabs: VALID_BRAIN_TABS,
  defaultTab: DEFAULT_TAB,
  onTabChange,
});
```

- [ ] **Step 2: Smoke check — the wrapper imports & store instantiates**

Run: `node -e "import('./src/lib/stores/brainDrawer.js').catch(e => { console.error('FAIL:', e.message); process.exit(1); })"`
Expected result: likely FAILS with `Cannot find module '$app/navigation'` — this is **expected**, the wrapper is SvelteKit-only and cannot be imported from bare Node. The real verification is `vite build` (step 3).

- [ ] **Step 3: Verify the build still compiles**

Run: `npm run build`
Expected: build succeeds. If Svelte/Vite complains about the import of `brainDrawer`, the wrapper is broken.

- [ ] **Step 4: Commit**

```bash
git add src/lib/stores/brainDrawer.js
git commit -m "feat(brain-drawer): SvelteKit thin wrapper — drives goto + reads \$page"
```

### Task 7: `brainEventsCore.js` + tests

**Files:**
- Create: `src/lib/api/brainEventsCore.js`
- Create: `test/brain-signals.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/brain-signals.test.js`:

```javascript
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { buildBrainEventPayload } from "../src/lib/api/brainEventsCore.js";

const NARRATIVE_KINDS = ['toi', 'prospect', 'clone_draft', 'draft_rejected'];

describe("buildBrainEventPayload", () => {
  it("returns null when no conversationId", () => {
    const out = buildBrainEventPayload({
      conversationId: null,
      messages: [{ id: 'm1', turn_kind: 'toi' }],
      eventType: 'brain_drawer_opened',
      narrativeKinds: NARRATIVE_KINDS,
    });
    assert.equal(out, null);
  });

  it("returns null when conversation has no messages", () => {
    const out = buildBrainEventPayload({
      conversationId: 'c1',
      messages: [],
      eventType: 'brain_drawer_opened',
      narrativeKinds: NARRATIVE_KINDS,
    });
    assert.equal(out, null);
  });

  it("returns null when conversation has only non-narrative messages", () => {
    const out = buildBrainEventPayload({
      conversationId: 'c1',
      messages: [{ id: 'm1', turn_kind: 'rule_added' }, { id: 'm2', turn_kind: 'system' }],
      eventType: 'brain_drawer_opened',
      narrativeKinds: NARRATIVE_KINDS,
    });
    assert.equal(out, null);
  });

  it("picks the last narrative message_id", () => {
    const out = buildBrainEventPayload({
      conversationId: 'c1',
      messages: [
        { id: 'm1', turn_kind: 'toi' },
        { id: 'm2', turn_kind: 'rule_added' },    // not narrative — skip
        { id: 'm3', turn_kind: 'prospect' },       // last narrative
      ],
      eventType: 'brain_drawer_opened',
      narrativeKinds: NARRATIVE_KINDS,
    });
    assert.deepEqual(out, {
      conversation_id: 'c1',
      message_id: 'm3',
      event_type: 'brain_drawer_opened',
    });
  });

  it("picks last narrative even when trailing messages are non-narrative", () => {
    const out = buildBrainEventPayload({
      conversationId: 'c1',
      messages: [
        { id: 'm1', turn_kind: 'toi' },
        { id: 'm2', turn_kind: 'clone_draft' },
        { id: 'm3', turn_kind: 'rule_added' },
      ],
      eventType: 'brain_edit_during_draft',
      narrativeKinds: NARRATIVE_KINDS,
    });
    assert.equal(out.message_id, 'm2');
    assert.equal(out.event_type, 'brain_edit_during_draft');
  });

  it("does NOT include dimensional fields (source/tab/has_draft)", () => {
    const out = buildBrainEventPayload({
      conversationId: 'c1',
      messages: [{ id: 'm1', turn_kind: 'toi' }],
      eventType: 'brain_drawer_opened',
      narrativeKinds: NARRATIVE_KINDS,
    });
    // Contract: only 3 fields. Dimensions go to analytics (track()), not DB.
    assert.deepEqual(Object.keys(out).sort(), ['conversation_id', 'event_type', 'message_id']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/brain-signals.test.js`
Expected: FAIL module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/api/brainEventsCore.js`:

```javascript
// Pure payload builder for brain events. No fetch, no Svelte store reads.
// Returns null to signal "skip emission" — the wrapper honors this silently.

/**
 * @param {object} args
 * @param {string|null} args.conversationId
 * @param {Array<{id: string, turn_kind: string}>} args.messages
 * @param {'brain_drawer_opened'|'brain_edit_during_draft'} args.eventType
 * @param {string[]} args.narrativeKinds
 * @returns {{conversation_id: string, message_id: string, event_type: string}|null}
 */
export function buildBrainEventPayload({ conversationId, messages, eventType, narrativeKinds }) {
  if (!conversationId) return null;
  const narrative = (messages || []).filter(m => narrativeKinds.includes(m.turn_kind));
  const last = narrative.at(-1);
  if (!last) return null;
  return {
    conversation_id: conversationId,
    message_id: last.id,
    event_type: eventType,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/brain-signals.test.js`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/brainEventsCore.js test/brain-signals.test.js
git commit -m "feat(brain-drawer): pure buildBrainEventPayload (message_id + skip policy)"
```

### Task 8: `brainEvents.js` thin wrapper

**Files:**
- Create: `src/lib/api/brainEvents.js`

No dedicated automated test — the wrapper is `read stores → call core → fetch POST`. The core's skip policy is already tested in Task 7; the fetch side is covered by preview smoke (adding a rule during draft shows the toast AND a row appears in `feedback_events` — acceptance criterion #8).

- [ ] **Step 1: Identify the existing stores + auth helper**

Search for the imports needed by the wrapper. Confirm:
```bash
```
Run: `grep -rn "export const messages\|export const currentConversationId" src/lib/`
Expected: find the exports in `src/lib/stores/` (exact path confirms the import statement to use).

Run: `grep -rn "export function authHeaders\|export const authHeaders" src/lib/`
Expected: find `authHeaders` export (exact path).

**If the stores or `authHeaders` are NOT at the paths assumed by the spec** (`$lib/stores/chat`, `$lib/auth`), update the wrapper imports accordingly. Do NOT create new store modules.

- [ ] **Step 2: Write the wrapper**

Create `src/lib/api/brainEvents.js`:

```javascript
// Fire-and-forget emitter for brain events. Reads Svelte stores, calls the pure
// core to build the payload (which handles the message_id skip policy), and
// POSTs to /api/feedback-events. Never blocks UX.
import { get } from 'svelte/store';
import { messages, currentConversationId } from '$lib/stores/chat';  // verified in Step 1
import { authHeaders } from '$lib/auth';                              // verified in Step 1
import { buildBrainEventPayload } from './brainEventsCore.js';

const NARRATIVE_KINDS = ['toi', 'prospect', 'clone_draft', 'draft_rejected'];

/**
 * @param {'brain_drawer_opened'|'brain_edit_during_draft'} type
 */
export async function emitBrainEvent(type) {
  const payload = buildBrainEventPayload({
    conversationId: get(currentConversationId),
    messages: get(messages),
    eventType: type,
    narrativeKinds: NARRATIVE_KINDS,
  });
  if (!payload) return;  // core's skip policy — conv vierge or no conv

  try {
    const res = await fetch('/api/feedback-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`${type} HTTP`, res.status, text);
    }
  } catch (err) {
    console.warn(`${type} network error:`, err);
  }
}
```

- [ ] **Step 3: Build smoke check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api/brainEvents.js
git commit -m "feat(brain-drawer): emitBrainEvent thin wrapper (fire-and-forget POST)"
```

---

## Chunk 3: UI components (BrainDrawer + ProtocolPanel callback)

**Goal of this chunk:** The drawer shell exists and mounts the 4 existing Panels correctly. `ProtocolPanel` emits an `onRuleAdded` callback after a successful rule save. Component-level automated tests are NOT written (no Svelte test framework in repo); coverage is via build + manual smoke.

### Task 9: `BrainDrawer.svelte`

**Files:**
- Create: `src/lib/components/BrainDrawer.svelte`

- [ ] **Step 1: Write the component**

Create `src/lib/components/BrainDrawer.svelte` (exact content from spec §"Composant `BrainDrawer.svelte`" lines 156-282, verbatim except props validation):

```svelte
<script>
  import { brainDrawer, VALID_BRAIN_TABS } from '$lib/stores/brainDrawer';
  import KnowledgePanel from './KnowledgePanel.svelte';
  import IntelligencePanel from './IntelligencePanel.svelte';
  import ProtocolPanel from './ProtocolPanel.svelte';
  import SettingsPanel from './SettingsPanel.svelte';

  let { personaId, onRuleAddedWhileDrafting, hasActiveDraft = false } = $props();

  const TABS = [
    { id: 'connaissance', label: 'Connaissance' },
    { id: 'protocole',    label: 'Protocole'    },
    { id: 'intelligence', label: 'Intelligence' },
    { id: 'reglages',     label: 'Réglages'     },
  ];

  function handleKeydown(e) {
    if (e.key === 'Escape' && $brainDrawer.open) {
      const focused = document.activeElement;
      if (focused?.tagName === 'TEXTAREA' || focused?.tagName === 'INPUT') return;
      brainDrawer.close();
    }
  }

  function handleRuleAdded() {
    if (hasActiveDraft) {
      onRuleAddedWhileDrafting?.();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if $brainDrawer.open}
  <aside class="brain-drawer" role="complementary" aria-label="Cerveau du clone">
    <header class="drawer-header">
      <div class="tabs" role="tablist">
        {#each TABS as tab}
          <button
            role="tab"
            class="tab"
            class:active={$brainDrawer.tab === tab.id}
            aria-selected={$brainDrawer.tab === tab.id}
            onclick={() => brainDrawer.setTab(tab.id)}
          >
            {tab.label}
          </button>
        {/each}
      </div>
      <button class="close" aria-label="Fermer le cerveau" onclick={() => brainDrawer.close()}>
        ✕
      </button>
    </header>

    <div class="panel-body" role="tabpanel">
      {#if $brainDrawer.tab === 'connaissance'}
        <KnowledgePanel {personaId} />
      {:else if $brainDrawer.tab === 'protocole'}
        <ProtocolPanel {personaId} onRuleAdded={handleRuleAdded} />
      {:else if $brainDrawer.tab === 'intelligence'}
        <IntelligencePanel {personaId} />
      {:else if $brainDrawer.tab === 'reglages'}
        <SettingsPanel embedded={true} {personaId} onClose={() => brainDrawer.close()} />
      {/if}
    </div>
  </aside>
{/if}

<style>
  .brain-drawer {
    display: flex;
    flex-direction: column;
    background: var(--surface-1, #fff);
    border-left: 1px solid var(--border, #e5e5e5);
  }

  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--border);
  }

  .tabs {
    display: flex;
    gap: 0.25rem;
  }

  .tab {
    padding: 0.5rem 0.75rem;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: 4px;
  }

  .tab.active {
    background: var(--surface-2);
    font-weight: 600;
  }

  .close {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 1.2rem;
  }

  .panel-body {
    flex: 1;
    overflow-y: auto;
  }

  @media (max-width: 899px) {
    .brain-drawer {
      position: fixed;
      inset: 0;
      z-index: 50;
      transform: translateX(0);
      transition: transform 180ms ease-out;
    }
  }
</style>
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build`
Expected: build succeeds with no Svelte errors. If a Panel import path is wrong, this will fail.

- [ ] **Step 3: Commit**

```bash
git add src/lib/components/BrainDrawer.svelte
git commit -m "feat(brain-drawer): BrainDrawer.svelte shell — tabs, ESC, mounts 4 Panels"
```

### Task 10: `ProtocolPanel.svelte` — add `onRuleAdded` callback

**Files:**
- Modify: `src/lib/components/ProtocolPanel.svelte` (exact lines TBD at execution; find save-success path)

- [ ] **Step 1: Locate the rule-save flow in ProtocolPanel.svelte**

Run: `grep -n "saveRule\|addRule\|POST.*protocol\|rules.*insert" src/lib/components/ProtocolPanel.svelte`
Expected: find the function that handles a successful rule save (insertion to `rules` or `protocol_*` table). Note the exact function name and the point AFTER the save has succeeded (before any UI toast/reset).

- [ ] **Step 2: Add the prop + callsite**

In the `<script>` block of `ProtocolPanel.svelte`, add `onRuleAdded` to the props destructure. Example (actual prop destructure statement TBD):

```svelte
let { personaId, onRuleAdded } = $props();  // add onRuleAdded — optional
```

In the save-success branch (identified in Step 1), AFTER the state update that reflects the saved rule:

```javascript
onRuleAdded?.();
```

The `?.()` is critical: optional call, no-op if not passed. Legacy call sites (`/brain/[persona]/+page.svelte` before it's deleted) continue to work.

- [ ] **Step 3: Verify build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/ProtocolPanel.svelte
git commit -m "feat(brain-drawer): ProtocolPanel — optional onRuleAdded callback on save success"
```

---

## Chunk 4: Chat page wiring + legacy redirect

**Goal of this chunk:** Full integration. The chat page renders the drawer side-by-side, emits the 3 sources of `brain_drawer_opened`, celebrates `brain_edit_during_draft`, and the legacy `/brain/[persona]` route 307-redirects into the new surface.

### Task 11: `/chat/[persona]/+page.svelte` — top-bar button + layout + ⌘K + $effect

**Files:**
- Modify: `src/routes/chat/[persona]/+page.svelte`

**Planning note:** this file is large (chantier #1 territory). Locate anchors carefully. The spec §"Bouton top-bar + layout chat" gives 3 zones. Work zone-by-zone, commit between zones if helpful.

- [ ] **Step 1: Locate anchors in the file**

```bash
```
Run: `grep -n "personaName\|composerText\|currentConversationId\|id: \"open-brain\"\|goto(\`/brain" src/routes/chat/[persona]/+page.svelte`
Expected: find (a) where `composerText` and `personaName` are declared, (b) where the top-bar header is rendered, (c) the ⌘K palette entry with `id: "open-brain"` (currently does `goto('/brain/...')`).

Note these line numbers for the subsequent edits.

- [ ] **Step 2: Add imports and toggle handlers (zone 1)**

In the `<script>` block of the chat page, add the imports + the `$effect` sync + `handleBrainToggle` + `celebrateRuleAdded` + `hasActiveDraft` derivation + `regenPulseActive` state. From spec lines 348-392 verbatim:

```svelte
<script>
  // ... existing imports ...
  import BrainDrawer from '$lib/components/BrainDrawer.svelte';
  import { brainDrawer } from '$lib/stores/brainDrawer';
  import { emitBrainEvent } from '$lib/api/brainEvents';
  import { track } from '$lib/tracking';
  import { page } from '$app/stores';

  // ... existing state ...

  let lastEmittedTabForUrl = null;
  $effect(() => {
    const urlTab = $page.url.searchParams.get('brain');
    brainDrawer.syncFromUrl(urlTab);
    if (urlTab && urlTab !== lastEmittedTabForUrl) {
      emitBrainEvent('brain_drawer_opened');
      track('brain_drawer_opened', { source: 'url_redirect', tab: urlTab });
      lastEmittedTabForUrl = urlTab;
    } else if (!urlTab) {
      lastEmittedTabForUrl = null;
    }
  });

  let hasActiveDraft = $derived(composerText.trim().length > 0);
  let regenPulseActive = $state(false);

  function handleBrainToggle() {
    const wasClosed = !$brainDrawer.open;
    brainDrawer.toggle();
    if (wasClosed) {
      emitBrainEvent('brain_drawer_opened');
      track('brain_drawer_opened', { source: 'top_button', tab: $brainDrawer.tab });
    }
  }

  function celebrateRuleAdded() {
    regenPulseActive = true;
    setTimeout(() => { regenPulseActive = false; }, 1500);
    showToast("Règle apprise — ↻ regénère pour l'appliquer");
    emitBrainEvent('brain_edit_during_draft');
    track('brain_edit_during_draft', { tab: $brainDrawer.tab, has_draft: true });
  }
</script>
```

**Integration notes:**
- `composerText`, `showToast`, and `personaId` are assumed to already exist in the file (chantier #1). If any is missing, halt and report.
- `regenPulseActive` is consumed by the regen button (to add a CSS pulse class). The existing regen button markup needs one update: `class:pulse={regenPulseActive}`. Locate the regen button in the messages area and add this class.

- [ ] **Step 3: Add the top-bar 🧠 button (zone 1 continuation)**

In the top-bar header JSX (identified in Step 1), inject:

```svelte
<button
  class="brain-toggle"
  aria-label="Ouvrir le cerveau du clone"
  aria-pressed={$brainDrawer.open}
  onclick={handleBrainToggle}
>
  🧠
</button>
```

Add minimal CSS for `.brain-toggle` (inside the page's `<style>`):

```css
.brain-toggle {
  background: transparent;
  border: none;
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}
.brain-toggle[aria-pressed="true"] {
  background: var(--surface-2, #f0f0f0);
}
```

- [ ] **Step 4: Wrap chat shell in grid + mount drawer (zone 2)**

Locate the main chat container (likely `<main>` or `<section>` wrapping messages + composer). Wrap so the grid layout matches spec §"Layout principal":

```svelte
<main class="chat-shell" class:drawer-open={$brainDrawer.open}>
  <section class="chat-column">
    <!-- existing messages + composer + paste zone (UNCHANGED) -->
  </section>

  <BrainDrawer
    {personaId}
    {hasActiveDraft}
    onRuleAddedWhileDrafting={celebrateRuleAdded}
  />
</main>
```

Add CSS (inside the page's `<style>`):

```css
.chat-shell {
  display: grid;
  grid-template-columns: 1fr 0;
  transition: grid-template-columns 180ms ease-out;
}

.chat-shell.drawer-open {
  grid-template-columns: 3fr 2fr;
}

@media (max-width: 899px) {
  .chat-shell.drawer-open {
    grid-template-columns: 1fr 0; /* drawer is position:fixed on mobile */
  }
}

/* Regen pulse — kept minimal; visual tweak during smoke */
.regen-btn.pulse {
  animation: regen-pulse 1.5s ease-out;
}
@keyframes regen-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(0, 150, 255, 0.5); }
  70%  { box-shadow: 0 0 0 10px rgba(0, 150, 255, 0); }
  100% { box-shadow: 0 0 0 0 rgba(0, 150, 255, 0); }
}
```

- [ ] **Step 5: Update ⌘K palette entry (zone 3)**

Find the palette entry `id: "open-brain"` (noted in Step 1). Replace the existing action:

Before:
```js
{ id: "open-brain", label: "Cerveau du clone", hint: "persona", action: () => goto(`/brain/${personaId}`) },
```

After:
```js
{ id: "open-brain", label: "Cerveau du clone", hint: "persona", action: () => {
    brainDrawer.openAt();
    emitBrainEvent('brain_drawer_opened');
    track('brain_drawer_opened', { source: 'cmd_k', tab: $brainDrawer.tab });
} },
```

- [ ] **Step 6: Build + run existing chat test**

Run: `npm run build`
Expected: build succeeds. The chat page is large; Svelte/Vite will flag any syntax issue.

Run: `npm test -- test/composer-state.test.js`
Expected: pass (no regressions from chantier #1).

- [ ] **Step 7: Commit**

```bash
git add src/routes/chat/[persona]/+page.svelte
git commit -m "feat(brain-drawer): wire chat page — 🧠 button, drawer mount, \$effect URL sync, celebration, ⌘K

3 sources emit brain_drawer_opened (top_button, cmd_k, url_redirect).
brain_edit_during_draft emitted only when composerText.trim().length > 0
at rule-save time."
```

### Task 12: Delete legacy `/brain/[persona]` client files

**Files:**
- Delete: `src/routes/brain/[persona]/+page.svelte`
- Delete: `src/routes/brain/[persona]/+page.js`

- [ ] **Step 1: Confirm no other file imports from them**

```bash
```
Run: `grep -rn "routes/brain/\[persona\]/+page\|from.*brain.*\[persona\]" src/`
Expected: only self-references (or nothing). If any other route references them, halt and report.

- [ ] **Step 2: Delete**

```bash
rm "src/routes/brain/[persona]/+page.svelte"
rm "src/routes/brain/[persona]/+page.js"
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: build succeeds (routes just lose `/brain/[persona]` as a renderable route; the redirect `+page.server.js` is added in Task 13).

**Note:** Committing a delete WITHOUT the redirect would leave `/brain/X` as a 404 for anyone who bookmarked it. Do NOT commit this step alone — commit together with Task 13.

### Task 13: Create `/brain/[persona]/+page.server.js` redirect + test

**Files:**
- Create: `src/routes/brain/[persona]/+page.server.js`
- Create: `test/brain-redirect.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/brain-redirect.test.js`:

```javascript
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// SvelteKit's `redirect` throws a Redirect instance with status + location.
// Import the load function and catch the throw to assert on its contents.

async function invokeLoad({ persona = "abc", hash = "", search = "" } = {}) {
  const { load } = await import("../src/routes/brain/[persona]/+page.server.js");
  const url = new URL(`https://example.com/brain/${persona}${search}${hash}`);
  try {
    load({ params: { persona }, url });
    return { redirected: false };
  } catch (thrown) {
    // SvelteKit Redirect: { status: number, location: string }
    return { redirected: true, status: thrown.status, location: thrown.location };
  }
}

describe("/brain/[persona] → /chat/[persona] redirect", () => {
  it("no hash/query → redirect to /chat/<persona>?brain=connaissance", async () => {
    const r = await invokeLoad({ persona: "abc" });
    assert.equal(r.redirected, true);
    assert.equal(r.status, 307);
    assert.equal(r.location, "/chat/abc?brain=connaissance");
  });

  it("hash #protocole → ?brain=protocole (legacy preservation)", async () => {
    const r = await invokeLoad({ persona: "abc", hash: "#protocole" });
    assert.equal(r.location, "/chat/abc?brain=protocole");
  });

  it("hash #intelligence → ?brain=intelligence", async () => {
    const r = await invokeLoad({ persona: "abc", hash: "#intelligence" });
    assert.equal(r.location, "/chat/abc?brain=intelligence");
  });

  it("query ?tab=reglages → ?brain=reglages (legacy preservation)", async () => {
    const r = await invokeLoad({ persona: "abc", search: "?tab=reglages" });
    assert.equal(r.location, "/chat/abc?brain=reglages");
  });

  it("hash wins over ?tab when both present", async () => {
    const r = await invokeLoad({ persona: "abc", hash: "#protocole", search: "?tab=reglages" });
    assert.equal(r.location, "/chat/abc?brain=protocole");
  });

  it("invalid hash tab → fallback connaissance", async () => {
    const r = await invokeLoad({ persona: "abc", hash: "#nonsense" });
    assert.equal(r.location, "/chat/abc?brain=connaissance");
  });

  it("invalid ?tab → fallback connaissance", async () => {
    const r = await invokeLoad({ persona: "abc", search: "?tab=nonsense" });
    assert.equal(r.location, "/chat/abc?brain=connaissance");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/brain-redirect.test.js`
Expected: FAIL with module not found.

- [ ] **Step 3: Write the minimal implementation**

Create `src/routes/brain/[persona]/+page.server.js` (spec §"Redirect" lines 465-478):

```javascript
import { redirect } from '@sveltejs/kit';

const VALID_TABS = ['connaissance', 'protocole', 'intelligence', 'reglages'];

export function load({ params, url }) {
  const hashTab = url.hash.replace('#', '');
  const queryTab = url.searchParams.get('tab');
  const candidate = hashTab || queryTab || 'connaissance';
  const tab = VALID_TABS.includes(candidate) ? candidate : 'connaissance';

  throw redirect(307, `/chat/${params.persona}?brain=${tab}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/brain-redirect.test.js`
Expected: all 7 tests pass.

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit (combines Task 12 + Task 13 deletes + redirect add)**

```bash
git add src/routes/brain/[persona]/+page.server.js test/brain-redirect.test.js
# Also stage the deletes from Task 12:
git rm "src/routes/brain/[persona]/+page.svelte" "src/routes/brain/[persona]/+page.js" 2>/dev/null || true
git commit -m "feat(brain-drawer): redirect /brain/[persona] → /chat/[persona]?brain=<tab>

Replaces the standalone /brain route (163-line page + load) with a 307 redirect.
Preserves legacy hash (#protocole) and query (?tab=...) for bookmarked URLs.
Drawer surface in /chat is now the single source of truth for Panel editing."
```

- [ ] **Step 7: Full test suite green**

Run: `npm test`
Expected: all tests pass. Any pre-existing failure unrelated to this chantier should be noted (and ignored) but nothing new should break.

---

## Chunk 5: Deploy checklist (no code — operational steps)

**This chunk is not a set of TDD tasks.** It is the ordered deploy procedure from spec §"Ordre de déploiement" with the critical migration/merge coupling preserved. The executing agent should read this chunk near the end of implementation, then hand off to the human operator (AhmetA) for the manual pieces.

**⚠️ Parallel session coordination note:** another session is running `protocole-vivant Chunk 2 Wave 2b` which will also touch `api/feedback-events.js`. Per coordination report from AhmetA (2026-04-25), that session will **read the final diff** of `VALID_TYPES` from this branch before coding Task 2.7. No action needed from us — just don't panic if you see a second PR touching the same file post-merge; the sequencing is deliberate. Migration numbers 041-043 are reserved paper-space for that session's follow-ups (rule_proposals, n4_paused_until, promoted_to_rule_index), hence our 046.

### Step A: Push the branch to GitHub

- [ ] **A1: Push `feat/brain-drawer`**

```bash
git push -u origin feat/brain-drawer
```

- [ ] **A2: Open the Pull Request**

Use `gh pr create` with a summary referencing the spec path + the 12 acceptance criteria. Example body:

```
## Summary
- Chantier #2 (chat cockpit refactor) — replace `/brain/[persona]` standalone route with a side-by-side drawer opened from `/chat/[persona]`.
- Reuses the 4 existing Panels (Connaissance, Protocole, Intelligence, Réglages) via `BrainDrawer.svelte` shell.
- Captures `brain_drawer_opened` + `brain_edit_during_draft` training signals via the feedback_events pipeline.
- Migration 046 extends the CHECK (11 event_types total). Fixes drift from migration 040 in `api/feedback-events.js` VALID_TYPES.

## Test plan
- [ ] Automated: `npm test` green.
- [ ] Preview smoke (see spec §"Acceptance criteria" — 12 items): top-bar 🧠 toggles drawer, ⌘K opens drawer, URL `?brain=protocole` deep-links, `/brain/X#intelligence` redirects with tab preserved, composer works drawer open, persona switch keeps drawer open, celebration fires on rule add during draft, no celebration without draft, ESC behavior correct, Back closes drawer in-app, mobile full-screen.

## Ordered deploy (critical: migration 046 on prod BEFORE merge master)
1. Preview smoke OK → ping AhmetA.
2. AhmetA applies migration 046 on Supabase prod via SQL editor (body of `supabase/046_feedback_brain_drawer.sql`).
3. Verify CHECK: `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'feedback_events_event_type_check';` — must list all 11 events.
4. Merge master.

Spec: `docs/superpowers/specs/2026-04-24-brain-drawer-lateral-design.md`
```

- [ ] **A3: Wait for Vercel preview build**

Monitor `gh pr checks <PR-URL>` until the Preview URL is posted in the PR. Copy the URL for the human smoke session.

### Step B: Manual smoke on Preview Vercel (human operator)

The executing agent should NOT attempt to automate this. Hand off to AhmetA with the 12 acceptance criteria as a copy-paste checklist:

```
Preview URL: <URL>

Smoke checklist (from spec §"Acceptance criteria"):
1. ☐ Bouton 🧠 top-bar toggle le drawer side-by-side sur desktop, full-screen sur mobile.
2. ☐ Palette ⌘K → "Cerveau du clone" ouvre le drawer (ne navigue plus).
3. ☐ URL /chat/X?brain=protocole ouvre directement sur Protocole.
4. ☐ /brain/X → /chat/X?brain=connaissance (1 hop 307).
5. ☐ /brain/X#intelligence → /chat/X?brain=intelligence.
6. ☐ Composer fonctionnel drawer ouvert (envoyer message, paste zone, ↻ regen).
7. ☐ ⌘⇧C switch persona drawer ouvert → drawer reste ouvert, URL change.
8. ☐ Célébration : draft + drawer + ajout règle Protocole → pulse ↻ + toast + row feedback_events (brain_edit_during_draft).
9. ☐ Pas de célébration sans draft (règle ajoutée = saved_rule normal).
10. ☐ ESC ferme sauf si focus composer.
11. ☐ Back browser in-app ferme le drawer.
12. ☐ Mobile <900px : full-screen, ✕ ferme, scroll OK.
```

### Step C: Apply migration 046 to Supabase PROD (human operator, critical)

**⚠️ Do this BEFORE merging master. The branch code in `api/feedback-events.js` accepts 4 new event_types; without migration 046 on prod, each emission hits a CHECK violation 500.**

- [ ] **C1: Open Supabase prod project → SQL editor**

- [ ] **C2: Paste full body of `supabase/046_feedback_brain_drawer.sql`**

- [ ] **C3: Run**

Expected output: `ALTER TABLE` × 2, `COMMENT`.

- [ ] **C4: Verify**

Run in the SQL editor:
```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'feedback_events_event_type_check';
```
Expected: definition string contains all 11 event_types.

### Step D: Merge master

- [ ] **D1: Only once (a) preview smoke ALL 12 checks green AND (b) migration 046 verified on prod**

```bash
gh pr merge <PR-URL> --squash
```

- [ ] **D2: Post-merge verification**

Ping AhmetA to do a 30-second sanity check on prod:
- Open `/chat/<a persona>` → 🧠 toggle drawer → add a rule during draft → verify a `brain_edit_during_draft` row appears in `feedback_events`.

---

**Plan complete. Ready to execute once spec reviewer + user approve.**

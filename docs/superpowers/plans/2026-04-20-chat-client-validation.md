# Chat — "c'est ça, je valide" — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a distinct validation action on `clone_draft` messages that captures explicit agency-client approval ("c'est ça, je valide") and feeds it into the learning loop as a stronger positive signal than the passive `validated`.

**Architecture:** New `event_type='client_validated'` in `feedback_events` (migration 031). New POST `/api/feedback` type `"client_validate"` path with a stronger entity-confidence boost (+0.12 vs +0.05 for passive validated). A second button in `ChatMessage.svelte` on draft turn_kind, wired to a new `handleClientValidate` in `/chat/[persona]/+page.svelte`. Journal entry in `FeedbackRail` gets a distinct icon.

**Tech Stack:** Supabase (Postgres) · Node serverless (Vercel) · Svelte 5 · SvelteKit · node:test.

**Prerequisite:** migrations 028–030 already applied in prod (shipped in PR #24).

---

## File Structure

- **New:** `supabase/031_feedback_client_validated.sql` — extends CHECK constraint on `feedback_events.event_type`
- **Modify:** `api/feedback-events.js` — add `'client_validated'` to `VALID_TYPES`
- **Modify:** `api/feedback.js` — add `type === "client_validate"` branch with stronger boost
- **Modify:** `src/lib/components/ChatMessage.svelte` — add `✓ c'est ça` button + `onClientValidate` callback prop
- **Modify:** `src/lib/components/FeedbackRail.svelte` — icon + label for `client_validated`
- **Modify:** `src/routes/chat/[persona]/+page.svelte` — new `handleClientValidate` handler + wire to `ChatMessage`
- **New test:** `test/api-feedback-client-validate.test.js` — POST flow + boost semantics
- **Extend test:** `test/api-feedback-events.test.js` — `client_validated` accepted as event_type

---

## Chunk 1 — DB + API layer

### Task 1.1: Migration 031 — extend event_type CHECK

**Files:**
- Create: `supabase/031_feedback_client_validated.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 031_feedback_client_validated.sql
-- Add 'client_validated' to feedback_events.event_type. Distinct from
-- 'validated' (passive: operator sent as-is) — this one means the agency-
-- client explicitly confirmed the clone captured their voice/intent.
-- Carries stronger learning weight. See spec 2026-04-20-chat-client-validation.

ALTER TABLE feedback_events
  DROP CONSTRAINT IF EXISTS feedback_events_event_type_check;

ALTER TABLE feedback_events
  ADD CONSTRAINT feedback_events_event_type_check
  CHECK (event_type IN ('validated','validated_edited','corrected','saved_rule','client_validated'));

COMMENT ON COLUMN feedback_events.event_type IS
  'Feedback taxonomy. client_validated = explicit external approval (stronger signal). See 031_feedback_client_validated.sql.';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/031_feedback_client_validated.sql
git commit -m "feat(db): migration 031 — client_validated event_type"
```

### Task 1.2: Extend `/api/feedback-events` VALID_TYPES — test first

**Files:**
- Modify: `test/api-feedback-events.test.js`
- Modify: `api/feedback-events.js`

- [ ] **Step 1: Add a failing test case for client_validated acceptance**

Read the existing test file and add a new case inside the POST describe block:

```javascript
it("accepts event_type='client_validated'", async () => {
  if (!HAS_DB) return;
  const { convId, msgId } = await seedConvAndMessage();
  const resp = await fetch(`${BASE}/api/feedback-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      conversation_id: convId,
      message_id: msgId,
      event_type: "client_validated",
    }),
  });
  assert.equal(resp.status, 201);
  const body = await resp.json();
  assert.ok(body.id);
});
```

*If the fixtures (`seedConvAndMessage`, `HAS_DB`, `BASE`, `authHeaders`) are named differently in the existing test, match the file's patterns — do not introduce new helpers.*

- [ ] **Step 2: Run test — expect FAIL (current VALID_TYPES rejects)**

Run: `node --test test/api-feedback-events.test.js`
Expected: new test fails with 400 `invalid event_type`.

- [ ] **Step 3: Minimal change in `api/feedback-events.js`**

```javascript
const VALID_TYPES = new Set(["validated", "validated_edited", "corrected", "saved_rule", "client_validated"]);
```

- [ ] **Step 4: Run test — expect PASS**

Run: `node --test test/api-feedback-events.test.js`
Expected: all tests pass including the new one.

- [ ] **Step 5: Commit**

```bash
git add test/api-feedback-events.test.js api/feedback-events.js
git commit -m "feat(api): feedback-events accepts client_validated"
```

### Task 1.3: Stronger reinforcement path — `/api/feedback` type="client_validate"

**Files:**
- Create: `test/api-feedback-client-validate.test.js`
- Modify: `api/feedback.js`

The existing `type === "validate"` branch applies +0.05 to matched entity confidences. The new `client_validate` branch applies +0.12 and marks the correction row with a distinct tag so future auditing can distinguish the two.

- [ ] **Step 1: Write the failing test**

Create `test/api-feedback-client-validate.test.js`:

```javascript
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const HAS_DB = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE);
const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";

const authHeaders = () => ({
  "Authorization": `Bearer ${process.env.TEST_ACCESS_CODE || "dev-access-code"}`,
});

describe("POST /api/feedback type=client_validate (requires DB)", { skip: !HAS_DB && "no DB env vars" }, () => {
  it("returns 200 with ok=true and records a correction row with CLIENT_VALIDATED marker", async () => {
    const resp = await fetch(`${BASE}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        type: "client_validate",
        botMessage: "Hello test message",
        persona: process.env.TEST_PERSONA_ID,
      }),
    });
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.ok, true);
    assert.equal(body.signal, "client_validated");
  });

  it("rejects missing botMessage with 400", async () => {
    const resp = await fetch(`${BASE}/api/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ type: "client_validate", persona: process.env.TEST_PERSONA_ID }),
    });
    assert.equal(resp.status, 400);
  });
});
```

*If this test file structure doesn't match siblings (ie. fixtures), adapt — do not diverge from the repo's test conventions.*

- [ ] **Step 2: Run test — expect FAIL (no such type yet)**

Run: `node --test test/api-feedback-client-validate.test.js`
Expected: fails (type unknown → likely 400 or 500 depending on current code path).

- [ ] **Step 3: Add the branch in `api/feedback.js`**

Insert right after the existing `type === "validate"` block (around line 171, before `type === "reject"`):

```javascript
  // ── Type "client_validate": strong positive signal — agency-client confirmed
  // the clone captured their voice. Applies a larger confidence boost than
  // passive "validated" and marks the correction row distinctly. ──
  if (type === "client_validate") {
    if (!botMessage) { res.status(400).json({ error: "botMessage required" }); return; }

    await supabase.from("corrections").insert({
      persona_id: intellId,
      correction: "[CLIENT_VALIDATED] Réponse confirmée par le client",
      bot_message: botMessage.slice(0, 300),
      user_message: userMessage?.slice(0, 200) || null,
      contributed_by: client?.id || null,
    });

    const { data: entities } = await supabase
      .from("knowledge_entities")
      .select("id, name, confidence")
      .eq("persona_id", intellId);

    if (entities?.length > 0) {
      const msgLower = botMessage.toLowerCase();
      const matched = entities.filter(e => msgLower.includes(e.name.toLowerCase()));
      for (const e of matched) {
        // +0.12 vs +0.05 on passive 'validate' — explicit client approval weighs more.
        const newConf = Math.min(1.0, (e.confidence || 0.8) + 0.12);
        await supabase.from("knowledge_entities")
          .update({ confidence: newConf, last_matched_at: new Date().toISOString() })
          .eq("id", e.id);
      }
    }

    clearIntelligenceCache(intellId);
    res.json({ ok: true, signal: "client_validated" });
    return;
  }
```

- [ ] **Step 4: Run test — expect PASS**

Run: `node --test test/api-feedback-client-validate.test.js`
Expected: both tests pass.

- [ ] **Step 5: Run full test suite — nothing regressed**

Run: `npm test`
Expected: all green (was 263 + 2 new = 265).

- [ ] **Step 6: Commit**

```bash
git add api/feedback.js test/api-feedback-client-validate.test.js
git commit -m "feat(api): /api/feedback type=client_validate with stronger entity boost (+0.12)"
```

### Task 1.4: End-of-chunk-1 verification

- [ ] **Step 1: Run full suite + build**

```bash
npm test
npm run build
```

Expected: all tests green, svelte compile clean.

- [ ] **Step 2: Tag**

```bash
git tag chunk-1-complete-chat-client-validation
```

**Livrable Chunk 1 validé quand :**
- Migration 031 prête à déployer (CHECK étendu)
- `/api/feedback-events` accepte `event_type='client_validated'`
- `/api/feedback` type=`client_validate` applique +0.12 et marque les corrections
- Suite de tests verte, build clean, pas de régression

---

## Chunk 2 — UI + journal rail

### Task 2.1: Add `onClientValidate` callback + button to `ChatMessage.svelte`

**Files:**
- Modify: `src/lib/components/ChatMessage.svelte`

- [ ] **Step 1: Add the prop**

Change the `$props()` destructure from:

```javascript
let {
  message, seq = null,
  onCorrect, onValidate, onRegen, onSaveRule, onCopyBlock,
} = $props();
```

to:

```javascript
let {
  message, seq = null,
  onCorrect, onValidate, onClientValidate, onRegen, onSaveRule, onCopyBlock,
} = $props();
```

- [ ] **Step 2: Insert the button inside the `{#if isDraft}` block**

Find the existing draft actions block (inside `msg-actions`, under `{#if isDraft}`) and add the new button right after the `✓ valider` button:

```svelte
{#if isDraft}
  <!-- Draft actions: valider → envoie au prospect ; corriger → FeedbackPanel ;
       regen → retry sans signal. -->
  <button class="action-btn action-btn-primary" onclick={() => onValidate?.(message)} title="Valider et envoyer">✓ valider</button>
  <button class="action-btn action-btn-strong" onclick={() => onClientValidate?.(message)} title="C'est ça, je valide — signal d'apprentissage positif">✓ c'est ça</button>
  <button class="action-btn" onclick={() => onCorrect?.(message)} title="Corriger">✎ corriger</button>
  <button class="action-btn" onclick={() => onRegen?.(message)} title="Regénérer sans correction">↻ regen</button>
{:else if isSent}
```

- [ ] **Step 3: Add the `.action-btn-strong` style**

Find the existing `.action-btn-primary` style block in the `<style>` section and add right after it:

```css
.action-btn-strong {
  border-color: var(--vermillon);
  color: var(--vermillon);
  font-weight: 600;
}
.action-btn-strong:hover {
  background: var(--vermillon);
  color: var(--paper);
}
```

- [ ] **Step 4: Smoke compile — svelte-check on this file**

Run: `npm run build` (whole-app compile is cheapest — no separate svelte-check script in repo).
Expected: no new warnings/errors on `ChatMessage.svelte`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/ChatMessage.svelte
git commit -m "feat(chat): add '✓ c'est ça' client-validation button on clone_draft"
```

### Task 2.2: Wire `handleClientValidate` in `/chat/[persona]/+page.svelte`

**Files:**
- Modify: `src/routes/chat/[persona]/+page.svelte`

- [ ] **Step 1: Duplicate `handleValidate` as `handleClientValidate`**

Right below the existing `handleValidate` function, add:

```javascript
  // ✓ c'est ça : explicit client approval. Flips turn_kind to 'toi' like
  // validate, but fires /api/feedback type=client_validate (stronger entity
  // boost) and logs feedback_events as 'client_validated'.
  async function handleClientValidate(message) {
    try {
      api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          type: "client_validate",
          botMessage: message.content,
          persona: get(currentPersonaId),
        }),
      }).catch(() => { /* secondary signal; non-blocking */ });

      await fetch(`/api/messages?id=${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ turn_kind: "toi" }),
      });

      const resp = await fetch("/api/feedback-events", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          conversation_id: $currentConversationId,
          message_id: message.id,
          event_type: "client_validated",
        }),
      });
      if (resp.ok) {
        const ev = await resp.json();
        feedbackRailRef?.appendEvent?.({
          id: ev.id,
          message_id: message.id,
          event_type: "client_validated",
          created_at: ev.created_at,
          rules_fired: [],
        });
        feedbackCount++;
      }
      messages.update(msgs => msgs.map(m =>
        m.id === message.id ? { ...m, turn_kind: "toi" } : m
      ));
    } catch {
      showToast?.("Validation échouée");
    }
  }
```

- [ ] **Step 2: Pass the handler to `ChatMessage`**

Find the `<ChatMessage` invocation and add the new prop:

```svelte
<ChatMessage
  {message}
  seq={seqForMessage(message, $messages)}
  onCorrect={handleCorrect}
  onValidate={handleValidate}
  onClientValidate={handleClientValidate}
  onRegen={handleRegen}
  onSaveRule={handleSaveRule}
  onCopyBlock={() => {}}
/>
```

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add src/routes/chat/[persona]/+page.svelte
git commit -m "feat(chat): handleClientValidate wires '✓ c'est ça' to api + rail"
```

### Task 2.3: `FeedbackRail.svelte` — icon + label for `client_validated`

**Files:**
- Modify: `src/lib/components/FeedbackRail.svelte`

- [ ] **Step 1: Add the new type to `iconFor` and `labelFor`**

In `iconFor`:

```javascript
function iconFor(type) {
  switch (type) {
    case "validated": return "✓";
    case "validated_edited": return "✓*";
    case "client_validated": return "✓✓";
    case "corrected": return "✎";
    case "saved_rule": return "📏";
    default: return "·";
  }
}
```

In `labelFor`:

```javascript
function labelFor(type) {
  switch (type) {
    case "validated": return "validé";
    case "validated_edited": return "validé (édité)";
    case "client_validated": return "c'est ça (client)";
    case "corrected": return "corrigé";
    case "saved_rule": return "règle enregistrée";
    default: return type;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/components/FeedbackRail.svelte
git commit -m "feat(rail): render client_validated with ✓✓ icon + 'c'est ça (client)' label"
```

### Task 2.4: End-of-chunk-2 verification

- [ ] **Step 1: Full build + tests**

```bash
npm run build
npm test
```

Expected: svelte build clean, tests all green.

- [ ] **Step 2: Manual smoke (cannot skip — UI behaviour)**

Start `npm run dev` with `vercel dev` (per memory: `vite dev` alone doesn't serve `api/`). Open `/chat/<persona>/<scenario>`, send a DM to get a `clone_draft`, verify :

- 4 action buttons render on the draft: `✓ valider`, `✓ c'est ça`, `✎ corriger`, `↻ regen`
- Click `✓ c'est ça` → message transitions to `toi` (actions disappear), new row appears in the FeedbackRail with `✓✓` icon and "c'est ça (client)" label
- `feedbackCount` in header increments

- [ ] **Step 3: Critic prod gate (if script exists)**

```bash
node scripts/critic-prod-check.js 2>/dev/null || echo "script missing — skip"
```

- [ ] **Step 4: Tag**

```bash
git tag chunk-2-complete-chat-client-validation
git log --oneline chunk-1-complete-chat-client-validation..HEAD
```

**Livrable Chunk 2 validé quand :**
- Bouton `✓ c'est ça` visible sur les `clone_draft`
- Click crée une entrée `client_validated` dans `feedback_events` et un boost +0.12 sur les entités matchées
- Rail affiche l'entrée avec `✓✓` + label explicite
- Build/tests verts

---

## Execution checklist globale

- [ ] Chunk 1 complet — tag `chunk-1-complete-chat-client-validation`, déployable indépendamment (migration + API)
- [ ] Chunk 2 complet — tag `chunk-2-complete-chat-client-validation`, UI + rail visibles

**Pre-merge gate :**
- Migration 031 appliquée sur Supabase prod avant merge
- `critic-prod-check.js` si existant

**Post-merge :**
- Suivre le taux d'usage de `client_validated` vs `validated` sur 1 semaine pour vérifier que le signal est utilisé (pas juste le bouton ignoré).

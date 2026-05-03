# Proposition Triage + Revert — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-accept conservateur des 379 propositions `pending` Nicolas pour matérialiser les artifacts manquants, avec mécanisme de revert (snapshot + UI) pour annuler tout auto-accept jugé mauvais a posteriori.

**Architecture:**
- Migration additive : flags `is_auto_accepted` / `accepted_by_rule` sur `proposition` + table `proposition_revert_snapshot` qui stocke `prose_before`/`prose_after` et `artifact_id` pour chaque mutation.
- Pipeline triage en deux étages : (1) règles déterministes pour la zone certaine (auto-accept ≥0.85 + intent + convergence ≥2 playbooks ; auto-reject <0.5), (2) Sonnet-assisté pour la zone grise (0.5-0.85). Chaque mutation passe par le helper `applyAcceptWithSnapshot` qui garantit l'atomicité prose-patch + artifact-create + snapshot-write.
- API + UI revert : endpoint `/api/v2/propositions/revert` qui restaure `prose_before`, désactive l'artifact (soft), et repasse la proposition en `pending`. Onglet `AutoAcceptReview` dans `ProtocolPanel` pour visualiser/annuler les auto-accepts récents.

**Tech Stack:**
- Supabase Postgres (DDL appliqué par l'utilisateur, conformément à la lane split)
- Node.js 24 + `@supabase/supabase-js` pour le script de triage
- Anthropic SDK pour le triage Sonnet (zone grise)
- SvelteKit + Svelte 5 runes pour l'UI
- Node test runner natif (`node --test`) pour les tests

**Out of scope (futurs plans) :**
- Picker dynamique avec sous-spyers + suppression de la limite 30 artifacts → Plan C
- Hygiène protocole : purge des `voice.writingRules` legacy + nettoyage de l'identity 23k chars → Plan B

---

## Context Snapshot (audit du 2026-05-03)

| Source | Propositions extraites | Status |
|---|---|---|
| dr_recue | 171 | la plupart `pending` |
| spyer | 91 | la plupart `pending` |
| visite_profil | 82 | la plupart `pending` |
| premier_degre | 74 | la plupart `pending` |
| upload_batch | 118 | la plupart `pending` |
| interaction_contenu | 29 | la plupart `pending` |
| chat_rewrite | 2 | — |
| **Total** | **567 (455 originales selon une 2e mesure)** | **75 mergées, 1 acceptée, 379 pending** |

Diagnostic : aucun mécanisme automatique ne fait `pending → accepted`. C'est `api/v2/propositions.js` (endpoint manuel UI) qui matérialise un `protocol_artifact` (uniquement pour `add_rule` + `add_paragraph`). D'où 21 artifacts spyer en DB pour ~95-105 attendus.

## File Structure

**À créer (nouveaux fichiers) :**

| Path | Responsabilité |
|---|---|
| `supabase/072_proposition_auto_accept_and_revert.sql` | Migration : 2 colonnes sur `proposition` + table `proposition_revert_snapshot` + index. **Appliquée par l'utilisateur côté Supabase** |
| `lib/proposition-accept.js` | Helper partagé `applyAcceptWithSnapshot({ supabase, propositionId, isAutoAccepted, ruleName })` — extrait depuis `api/v2/propositions.js`, garantit prose-patch + artifact + snapshot atomiques |
| `lib/triage-rules.js` | Pure functions de décision : `decideTriage(prop) → { decision: 'auto_accept' | 'auto_reject' | 'gray_zone', rule_name, reason }` |
| `lib/triage-sonnet.js` | Wrapper Sonnet pour zone grise : `triageGrayZone(supabase, propositions, sectionContextById) → Array<{ id, decision, reason }>` |
| `scripts/triage-pending-propositions.js` | Orchestrateur : récupère pending, applique les règles, batch Sonnet pour zone grise, applique via helper, log audit complet |
| `api/v2/propositions/revert.js` | Endpoint POST `{ propositionId }` qui restaure `prose_before`, soft-deactive l'artifact, repasse status à `pending` |
| `src/lib/components/protocol-v2/AutoAcceptReview.svelte` | Onglet de review, liste filtrable, diff prose, bouton "Annuler" |
| `src/lib/components/protocol-v2/AutoAcceptCard.svelte` | Carte par auto-accept (intent, target_section, prose ajoutée, bouton revert) |
| `test/triage-rules.test.js` | Tests purs des règles de décision |
| `test/proposition-accept.test.js` | Tests du helper avec mock Supabase |
| `test/proposition-revert.test.js` | Tests revert (cas nominal + cas conflit prose modifiée depuis) |

**À modifier (fichiers existants) :**

| Path | Modification |
|---|---|
| `api/v2/propositions.js:185-249` | Remplacer le bloc accept inline par un appel à `applyAcceptWithSnapshot` (le helper fait tout) — passer `isAutoAccepted=false` côté UI manuelle |
| `lib/protocol-v2-db.js` (fin de fichier) | Ajouter `getRecentAutoAccepts(sb, personaId, { limit = 50, since })` — query joint `proposition` + `protocol_section` + `proposition_revert_snapshot` |
| `src/lib/components/ProtocolPanel.svelte` | Ajouter onglet "Auto-accepts" qui mount `AutoAcceptReview` |

---

## Task 1: Migration DDL

**Files:**
- Create: `supabase/072_proposition_auto_accept_and_revert.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- supabase/072_proposition_auto_accept_and_revert.sql
-- Adds auto-accept tracking to proposition + a snapshot table to support
-- atomic revert of any auto-accepted proposition.
--
-- Why a separate snapshot table rather than a column on proposition :
-- prose_before may be large (sections grow to several KB). Keeping it off
-- the hot proposition row keeps that table compact. Also lets us record
-- multiple snapshots if we ever re-accept after revert.

ALTER TABLE proposition
  ADD COLUMN IF NOT EXISTS is_auto_accepted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS accepted_by_rule text NULL;

COMMENT ON COLUMN proposition.is_auto_accepted IS
  'TRUE when accepted by the triage script (Plan A 2026-05-03). FALSE for manual UI accepts and pre-existing rows.';

COMMENT ON COLUMN proposition.accepted_by_rule IS
  'Identifier of the rule that triggered the auto-accept, e.g. high_confidence_simple, doctrine_convergence, sonnet_gray_zone. NULL for manual.';

CREATE TABLE IF NOT EXISTS proposition_revert_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposition_id uuid NOT NULL REFERENCES proposition(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES protocol_section(id) ON DELETE CASCADE,
  artifact_id uuid NULL REFERENCES protocol_artifact(id) ON DELETE SET NULL,
  prose_before text NOT NULL,
  prose_after text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_revert_snapshot_proposition
  ON proposition_revert_snapshot (proposition_id);

CREATE INDEX IF NOT EXISTS idx_revert_snapshot_active
  ON proposition_revert_snapshot (section_id, applied_at DESC)
  WHERE reverted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_proposition_auto_accepted
  ON proposition (document_id, resolved_at DESC)
  WHERE is_auto_accepted = true AND status = 'accepted';
```

- [ ] **Step 2: Commit migration file**

```bash
git add supabase/072_proposition_auto_accept_and_revert.sql
git commit -m "migration(072): proposition auto-accept flags + revert snapshot

Adds is_auto_accepted/accepted_by_rule columns and a proposition_revert_snapshot
table to support atomic auto-accept + revert. Required by triage script (Plan A
2026-05-03)."
```

- [ ] **Step 3: User applies migration in Supabase**

Out-of-band step. The user owns DDL (cf memory). Once applied, verify with:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'proposition' AND column_name IN ('is_auto_accepted', 'accepted_by_rule');
-- expect 2 rows

SELECT to_regclass('proposition_revert_snapshot');
-- expect: proposition_revert_snapshot
```

---

## Task 2: Triage rules (pure decision functions)

**Files:**
- Create: `lib/triage-rules.js`
- Create: `test/triage-rules.test.js`

- [ ] **Step 1: Write failing tests**

```js
// test/triage-rules.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideTriage } from "../lib/triage-rules.js";

test("auto_accept: high confidence + safe intent", () => {
  const r = decideTriage({ confidence: 0.9, intent: "add_rule", target_kind: "hard_rules", provenance: {} });
  assert.equal(r.decision, "auto_accept");
  assert.equal(r.rule_name, "high_confidence_simple");
});

test("auto_accept: doctrine convergence (≥2 playbooks) at lower confidence", () => {
  const r = decideTriage({
    confidence: 0.78,
    intent: "add_paragraph",
    target_kind: "process",
    provenance: { playbook_sources: [{ source_core: "spyer" }, { source_core: "visite_profil" }] },
  });
  assert.equal(r.decision, "auto_accept");
  assert.equal(r.rule_name, "doctrine_convergence");
});

test("gray_zone: medium confidence, no convergence", () => {
  const r = decideTriage({ confidence: 0.65, intent: "add_rule", target_kind: "hard_rules", provenance: {} });
  assert.equal(r.decision, "gray_zone");
});

test("auto_reject: low confidence", () => {
  const r = decideTriage({ confidence: 0.3, intent: "add_rule", target_kind: "hard_rules", provenance: {} });
  assert.equal(r.decision, "auto_reject");
  assert.equal(r.rule_name, "low_confidence");
});

test("gray_zone: amend intents are never auto-accepted (too risky)", () => {
  const r = decideTriage({ confidence: 0.95, intent: "amend_paragraph", target_kind: "process", provenance: {} });
  assert.equal(r.decision, "gray_zone");
  assert.equal(r.rule_name, "amend_intent_requires_review");
});

test("gray_zone: remove_rule never auto-accepted", () => {
  const r = decideTriage({ confidence: 0.99, intent: "remove_rule", target_kind: "hard_rules", provenance: {} });
  assert.equal(r.decision, "gray_zone");
});

test("auto_reject: unknown intent (defensive)", () => {
  const r = decideTriage({ confidence: 0.9, intent: "weird_thing", target_kind: "hard_rules", provenance: {} });
  assert.equal(r.decision, "gray_zone");
  assert.equal(r.rule_name, "unknown_intent");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/triage-rules.test.js
```

Expected: all FAIL with "Cannot find module '../lib/triage-rules.js'"

- [ ] **Step 3: Implement decision rules**

```js
// lib/triage-rules.js
//
// Pure decision functions for the auto-accept triage pipeline.
// No I/O, no LLM. Inputs: a proposition row's relevant fields.
//
// Decision matrix:
//   confidence >= 0.85 + intent in {add_rule, add_paragraph}  → auto_accept (high_confidence_simple)
//   convergence (≥2 playbook_sources) + confidence >= 0.7    → auto_accept (doctrine_convergence)
//   confidence < 0.5                                          → auto_reject (low_confidence)
//   intent in {amend_paragraph, refine_pattern, remove_rule}  → gray_zone (amend_intent_requires_review)
//   intent unknown                                            → gray_zone (unknown_intent)
//   else                                                      → gray_zone

const SAFE_INTENTS = new Set(["add_rule", "add_paragraph"]);
const KNOWN_INTENTS = new Set([
  "add_rule", "add_paragraph",
  "amend_paragraph", "refine_pattern", "remove_rule",
]);

export function decideTriage(prop) {
  const conf = typeof prop.confidence === "number" ? prop.confidence : 0;
  const intent = prop.intent || "";
  const sources = prop?.provenance?.playbook_sources || [];
  const distinctSources = new Set(sources.map((s) => s.source_core).filter(Boolean));

  if (!KNOWN_INTENTS.has(intent)) {
    return { decision: "gray_zone", rule_name: "unknown_intent", reason: `intent '${intent}' not in known set` };
  }

  if (!SAFE_INTENTS.has(intent)) {
    return {
      decision: "gray_zone",
      rule_name: "amend_intent_requires_review",
      reason: `intent '${intent}' modifies existing structure`,
    };
  }

  if (conf < 0.5) {
    return { decision: "auto_reject", rule_name: "low_confidence", reason: `confidence ${conf} < 0.5` };
  }

  if (conf >= 0.85) {
    return { decision: "auto_accept", rule_name: "high_confidence_simple", reason: `confidence ${conf} >= 0.85` };
  }

  if (conf >= 0.7 && distinctSources.size >= 2) {
    return {
      decision: "auto_accept",
      rule_name: "doctrine_convergence",
      reason: `confidence ${conf} >= 0.7 with ${distinctSources.size} converging playbooks`,
    };
  }

  return { decision: "gray_zone", rule_name: "default_gray", reason: "no rule matched" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test/triage-rules.test.js
```

Expected: 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/triage-rules.js test/triage-rules.test.js
git commit -m "feat(triage): pure decision rules for auto-accept

Adds decideTriage(prop) returning auto_accept|auto_reject|gray_zone
based on confidence, intent and doctrine convergence (Plan A 2026-05-03)."
```

---

## Task 3: applyAcceptWithSnapshot helper (atomic accept + snapshot)

**Files:**
- Create: `lib/proposition-accept.js`
- Create: `test/proposition-accept.test.js`
- Modify: `api/v2/propositions.js` (refactor accept path to use helper)

- [ ] **Step 1: Write failing test (happy path)**

```js
// test/proposition-accept.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAcceptWithSnapshot } from "../lib/proposition-accept.js";

function buildMockSb(state) {
  return {
    from(table) {
      return {
        select: () => this,
        eq: () => this,
        single: async () => state[table].single?.(),
        update: (patch) => ({
          eq: () => ({
            select: () => ({ single: async () => state[table].update?.(patch) }),
          }),
        }),
        insert: (row) => ({
          select: () => ({ single: async () => state[table].insert?.(row) }),
        }),
      };
    },
  };
}

test("happy path: snapshots prose_before, patches prose, creates artifact", async () => {
  const calls = { sectionUpdate: null, snapshotInsert: null, artifactInsert: null };
  const sb = buildMockSb({
    proposition: {
      single: async () => ({
        data: {
          id: "p1", document_id: "d1", target_section_id: "s1",
          intent: "add_rule", target_kind: "hard_rules",
          proposed_text: "Toujours signer Nicolas", confidence: 0.9,
          rationale: null,
        },
        error: null,
      }),
      update: (patch) => ({ data: { id: "p1", ...patch }, error: null }),
    },
    protocol_section: {
      single: async () => ({
        data: { id: "s1", document_id: "d1", kind: "hard_rules", prose: "Old prose" },
        error: null,
      }),
      update: (patch) => { calls.sectionUpdate = patch; return { data: null, error: null }; },
    },
    proposition_revert_snapshot: {
      insert: (row) => { calls.snapshotInsert = row; return { data: { id: "snap1" }, error: null }; },
    },
    protocol_artifact: {
      insert: (row) => { calls.artifactInsert = row; return { data: { id: "art1" }, error: null }; },
    },
  });

  const result = await applyAcceptWithSnapshot({
    supabase: sb,
    propositionId: "p1",
    isAutoAccepted: true,
    ruleName: "high_confidence_simple",
  });

  assert.equal(result.ok, true);
  assert.match(calls.sectionUpdate.prose, /Toujours signer Nicolas/);
  assert.equal(calls.snapshotInsert.prose_before, "Old prose");
  assert.match(calls.snapshotInsert.prose_after, /Toujours signer Nicolas/);
  assert.equal(calls.artifactInsert.kind, "hard_check");
  assert.equal(result.snapshot_id, "snap1");
});

test("snapshot uses empty string when section.prose is null", async () => {
  const calls = { snapshotInsert: null };
  const sb = buildMockSb({
    proposition: {
      single: async () => ({
        data: { id: "p2", document_id: "d1", target_section_id: "s1", intent: "add_paragraph", target_kind: "process", proposed_text: "Text", confidence: 0.9 },
        error: null,
      }),
      update: () => ({ data: {}, error: null }),
    },
    protocol_section: {
      single: async () => ({ data: { id: "s1", document_id: "d1", kind: "process", prose: null }, error: null }),
      update: () => ({ data: null, error: null }),
    },
    proposition_revert_snapshot: {
      insert: (row) => { calls.snapshotInsert = row; return { data: { id: "snap2" }, error: null }; },
    },
    protocol_artifact: {
      insert: () => ({ data: { id: "art2" }, error: null }),
    },
  });
  await applyAcceptWithSnapshot({ supabase: sb, propositionId: "p2", isAutoAccepted: true, ruleName: "x" });
  assert.equal(calls.snapshotInsert.prose_before, "");
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
node --test test/proposition-accept.test.js
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Implement helper**

```js
// lib/proposition-accept.js
//
// Shared accept pipeline used by both the manual UI endpoint
// (api/v2/propositions.js, action='accept') and the auto-accept triage
// script (scripts/triage-pending-propositions.js).
//
// Steps (in order, all best-effort except the section patch which is the
// one we care about most) :
//   1. fetch proposition
//   2. resolve target section (by id, fallback by kind)
//   3. snapshot prose_before
//   4. patch section.prose (append)
//   5. update proposition (status=accepted, is_auto_accepted, accepted_by_rule)
//   6. insert revert snapshot row (with artifact_id once known)
//   7. materialize protocol_artifact (only for add_rule / add_paragraph)
//   8. backfill snapshot.artifact_id
//
// On Supabase error at any step, returns { ok: false, step, error }.
// The section patch is the canonical mutation — if steps 6/7/8 fail,
// caller can re-run the accept against the same proposition without
// duplicating the patch (idempotent because status=accepted prevents re-entry).

import { computeArtifactHash } from "./protocol-v2-db.js";
import { deriveCheckParams } from "./protocol-v2-check-derivation.js";

const INTENT_TO_ARTIFACT_KIND = {
  add_rule: "hard_check",
  add_paragraph: "pattern",
};
const ARTIFACT_KIND_TO_SEVERITY = {
  hard_check: "hard",
  pattern: "light",
};
const AMEND_INTENTS = new Set(["amend_paragraph", "refine_pattern", "remove_rule"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function patchProse(currentProse, prop) {
  const text = (prop?.proposed_text || "").trim();
  if (!text) return currentProse || "";
  const base = currentProse || "";
  const sep = base && !base.endsWith("\n") ? "\n\n" : "";
  if (AMEND_INTENTS.has(prop?.intent)) {
    return `${base}${sep}[${prop.intent}] ${text}`;
  }
  return `${base}${sep}${text}`;
}

async function resolveTargetSection(sb, prop) {
  if (prop.target_section_id && UUID_RE.test(prop.target_section_id)) {
    const { data } = await sb
      .from("protocol_section")
      .select("id, document_id, kind, prose")
      .eq("id", prop.target_section_id)
      .single();
    if (data && data.document_id === prop.document_id) return data;
  }
  const { data } = await sb
    .from("protocol_section")
    .select("id, document_id, kind, prose")
    .eq("document_id", prop.document_id)
    .eq("kind", prop.target_kind)
    .single();
  return data || null;
}

export async function applyAcceptWithSnapshot({
  supabase,
  propositionId,
  isAutoAccepted = false,
  ruleName = null,
}) {
  // 1. fetch proposition
  const { data: prop, error: pErr } = await supabase
    .from("proposition")
    .select("id, document_id, intent, target_kind, target_section_id, proposed_text, rationale, confidence")
    .eq("id", propositionId)
    .single();
  if (pErr || !prop) return { ok: false, step: "fetch_proposition", error: pErr?.message || "not found" };

  // 2. resolve target section
  const section = await resolveTargetSection(supabase, prop);
  if (!section) return { ok: false, step: "resolve_section", error: "no target section" };

  // 3. snapshot prose_before
  const proseBefore = section.prose || "";
  const proseAfter = patchProse(proseBefore, prop);

  // 4. patch section
  const { error: sErr } = await supabase
    .from("protocol_section")
    .update({ prose: proseAfter, author_kind: isAutoAccepted ? "proposition_auto_accepted" : "proposition_accepted" })
    .eq("id", section.id);
  if (sErr) return { ok: false, step: "patch_section", error: sErr.message };

  // 5. update proposition
  const propUpdate = {
    status: "accepted",
    resolved_at: new Date().toISOString(),
    target_section_id: section.id,
    is_auto_accepted: isAutoAccepted,
    accepted_by_rule: ruleName,
  };
  await supabase.from("proposition").update(propUpdate).eq("id", propositionId).select().single();

  // 6. snapshot row (without artifact_id yet)
  const { data: snap } = await supabase
    .from("proposition_revert_snapshot")
    .insert({
      proposition_id: propositionId,
      section_id: section.id,
      prose_before: proseBefore,
      prose_after: proseAfter,
    })
    .select("id")
    .single();

  // 7. materialize artifact
  let artifactId = null;
  const kind = INTENT_TO_ARTIFACT_KIND[prop.intent];
  if (kind) {
    const text = (prop.proposed_text || "").trim();
    const hash = computeArtifactHash(text);
    if (hash) {
      let derivation = null;
      if (kind === "hard_check") {
        derivation = await deriveCheckParams(text).catch(() => null);
      }
      const { data: art } = await supabase
        .from("protocol_artifact")
        .insert({
          source_section_id: section.id,
          source_quote: prop.rationale || null,
          kind,
          content: {
            text,
            intent: prop.intent,
            source_proposition_id: prop.id,
            source_kind: prop.target_kind,
            confidence: prop.confidence,
            ...(derivation ? { check_kind: derivation.check_kind, check_params: derivation.check_params } : {}),
          },
          severity: ARTIFACT_KIND_TO_SEVERITY[kind],
          content_hash: hash,
        })
        .select("id")
        .single();
      artifactId = art?.id || null;
    }
  }

  // 8. backfill snapshot.artifact_id (best-effort)
  if (snap?.id && artifactId) {
    await supabase
      .from("proposition_revert_snapshot")
      .update({ artifact_id: artifactId })
      .eq("id", snap.id);
  }

  return { ok: true, snapshot_id: snap?.id || null, artifact_id: artifactId, section_id: section.id };
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
node --test test/proposition-accept.test.js
```

Expected: 2 tests passing.

- [ ] **Step 5: Refactor `api/v2/propositions.js` accept path to use helper**

In `api/v2/propositions.js`, replace the entire ACCEPT block (currently lines 185–249) with:

```js
// ── ACCEPT path ───────────────────────────────────────────────
if (action === "accept") {
  const result = await applyAcceptWithSnapshot({
    supabase,
    propositionId: id,
    isAutoAccepted: false,
    ruleName: null,
  });
  if (!result.ok) {
    res.status(result.step === "resolve_section" ? 422 : 500).json({ error: `accept failed at ${result.step}` });
    return;
  }
  // Re-fetch the proposition to return the canonical state.
  const { data: refreshed } = await supabase
    .from("proposition").select(PROPOSITION_COLUMNS).eq("id", id).single();
  // Persist user_note if provided.
  if (user_note !== undefined) {
    await supabase.from("proposition").update({ user_note }).eq("id", id);
  }
  // Log positive training example (kept here, not in the helper, so the
  // triage script doesn't pollute the training set with auto-accepts).
  const trainingExampleId = await logTrainingExample(supabase, {
    personaId,
    proposition: prop,
    outcome: "accepted",
    userNote: user_note,
  });
  res.status(200).json({
    proposition: refreshed,
    section: { id: result.section_id },
    training_example_id: trainingExampleId,
    artifact_id: result.artifact_id,
  });
  return;
}
```

Add the import at the top of the file:

```js
import { applyAcceptWithSnapshot } from "../../lib/proposition-accept.js";
```

Remove the now-unused local helpers `materializeArtifact`, `resolveTargetSection`, and the local `patchProse` (they are now in `lib/proposition-accept.js`).

- [ ] **Step 6: Run existing test suite for the propositions API**

```bash
node --test test/v2-propositions*.test.js
```

Expected: all green. If any test breaks because it asserted on the local helpers, port the assertion to import from `lib/proposition-accept.js` instead.

- [ ] **Step 7: Commit**

```bash
git add lib/proposition-accept.js test/proposition-accept.test.js api/v2/propositions.js
git commit -m "feat(propositions): extract accept pipeline into shared helper

Refactors api/v2/propositions.js accept path into lib/proposition-accept.js
so the triage script can reuse the exact same atomic accept + snapshot
logic. Adds revert snapshot writing on every accept.

Plan A 2026-05-03, Task 3."
```

---

## Task 4: Triage Sonnet helper for gray zone

**Files:**
- Create: `lib/triage-sonnet.js`
- Create: `test/triage-sonnet.test.js`

- [ ] **Step 1: Write failing test (with mocked Anthropic client)**

```js
// test/triage-sonnet.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { triageGrayZone } from "../lib/triage-sonnet.js";

test("returns one decision per proposition, parses Sonnet JSON output", async () => {
  const mockClient = {
    messages: {
      create: async ({ messages }) => {
        // Sanity check: prompt mentions all input ids
        const userText = messages[0].content;
        assert.match(userText, /p1/);
        assert.match(userText, /p2/);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              decisions: [
                { id: "p1", decision: "accept", reason: "matches doctrine" },
                { id: "p2", decision: "reject", reason: "duplicate of existing rule" },
              ],
            }),
          }],
        };
      },
    },
  };

  const props = [
    { id: "p1", proposed_text: "Max 6 lignes par message", target_kind: "hard_rules", intent: "add_rule", confidence: 0.7 },
    { id: "p2", proposed_text: "Toujours saluer", target_kind: "hard_rules", intent: "add_rule", confidence: 0.6 },
  ];
  const sectionContext = { hard_rules: "Existing prose..." };

  const out = await triageGrayZone({ client: mockClient, propositions: props, sectionContextByKind: sectionContext });

  assert.equal(out.length, 2);
  assert.equal(out.find((d) => d.id === "p1").decision, "accept");
  assert.equal(out.find((d) => d.id === "p2").decision, "reject");
});

test("handles malformed Sonnet output gracefully (returns gray_zone for missing ids)", async () => {
  const mockClient = {
    messages: {
      create: async () => ({ content: [{ type: "text", text: "not json" }] }),
    },
  };
  const out = await triageGrayZone({
    client: mockClient,
    propositions: [{ id: "p1", proposed_text: "x", target_kind: "process", intent: "add_paragraph", confidence: 0.7 }],
    sectionContextByKind: {},
  });
  assert.equal(out[0].decision, "gray_zone");
  assert.match(out[0].reason, /sonnet_parse_error|missing/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/triage-sonnet.test.js
```

- [ ] **Step 3: Implement Sonnet wrapper**

```js
// lib/triage-sonnet.js
//
// LLM-assisted triage for the gray zone (propositions where deterministic
// rules can't decide). Sends a batch of N propositions + section context
// in one Sonnet call, expects strict JSON back.
//
// Why batched : each Sonnet call has overhead. ~10-20 props per batch
// keeps token use reasonable while amortizing the prompt header.
//
// Output decision is one of:
//   - "accept"   : Sonnet judges it valuable and non-redundant
//   - "reject"   : duplicate, unclear, or off-doctrine
//   - "gray_zone": fallback when parsing fails (caller leaves pending)

const SYSTEM_PROMPT = `You are an editorial reviewer for a sales playbook system. You receive PROPOSITIONS extracted from operational documents and decide if each one should be ACCEPTED into a section's prose, REJECTED, or LEFT FOR HUMAN REVIEW.

Criteria:
- ACCEPT: the proposition adds clear, actionable, non-redundant value to the target section. Specific over generic. Doctrine-coherent.
- REJECT: duplicate of an existing rule in the section, vague platitude, off-topic, badly worded.
- gray_zone: anything you're unsure about — when in doubt, leave for human.

Output strict JSON only:
{
  "decisions": [
    { "id": "<proposition_id>", "decision": "accept" | "reject" | "gray_zone", "reason": "<one short sentence>" }
  ]
}`;

function buildUserMessage(propositions, sectionContextByKind) {
  const sections = Object.entries(sectionContextByKind || {})
    .map(([kind, prose]) => `--- SECTION ${kind} (current prose) ---\n${(prose || "").slice(0, 2000)}\n`)
    .join("\n");

  const props = propositions.map((p) => {
    return `[${p.id}] (target=${p.target_kind}, intent=${p.intent}, conf=${p.confidence})
${p.proposed_text}`;
  }).join("\n\n");

  return `${sections}\n\n=== PROPOSITIONS TO TRIAGE ===\n\n${props}\n\nReturn JSON only.`;
}

function parseDecisions(text, expectedIds) {
  try {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed?.decisions) ? parsed.decisions : [];
    const out = [];
    const byId = new Map(list.map((d) => [d.id, d]));
    for (const id of expectedIds) {
      const d = byId.get(id);
      if (d && ["accept", "reject", "gray_zone"].includes(d.decision)) {
        out.push({ id, decision: d.decision, reason: d.reason || "" });
      } else {
        out.push({ id, decision: "gray_zone", reason: "missing from sonnet output" });
      }
    }
    return out;
  } catch {
    return expectedIds.map((id) => ({ id, decision: "gray_zone", reason: "sonnet_parse_error" }));
  }
}

export async function triageGrayZone({ client, propositions, sectionContextByKind, model = "claude-sonnet-4-6" }) {
  if (!propositions || propositions.length === 0) return [];
  const userMessage = buildUserMessage(propositions, sectionContextByKind);
  const ids = propositions.map((p) => p.id);

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (err) {
    return ids.map((id) => ({ id, decision: "gray_zone", reason: `sonnet_call_failed: ${err?.message || "unknown"}` }));
  }

  const text = response?.content?.[0]?.text || "";
  return parseDecisions(text, ids);
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
node --test test/triage-sonnet.test.js
```

- [ ] **Step 5: Commit**

```bash
git add lib/triage-sonnet.js test/triage-sonnet.test.js
git commit -m "feat(triage): Sonnet-assisted decision for gray-zone propositions

Batches up to N propositions per call, returns accept/reject/gray_zone
decisions. Falls back to gray_zone on parse error or API failure (safe
default — caller leaves pending). Plan A 2026-05-03, Task 4."
```

---

## Task 5: Triage orchestrator script (dry-run + apply modes)

**Files:**
- Create: `scripts/triage-pending-propositions.js`

- [ ] **Step 1: Write the script**

```js
// scripts/triage-pending-propositions.js
//
// Orchestrator : récupère les propositions pending d'un persona, applique
// les règles déterministes (decideTriage), batche la zone grise vers
// Sonnet, applique les décisions via applyAcceptWithSnapshot.
//
// Usage :
//   node --env-file=.env.local scripts/triage-pending-propositions.js [--persona=<slug>] [--apply] [--source=<source_core>] [--max=<n>]
//
//   --persona  Default = nicolas-lavall-e
//   --apply    Default = dry-run (compte les décisions, n'écrit rien)
//   --source   Filtre sur un source_core (ex --source=spyer)
//   --max      Plafond de propositions traitées (default = 1000, safety net)
//
// Idempotent : ne traite que les propositions status='pending'. Une seconde
// exécution ne touche pas les déjà-accepted/rejected.

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { decideTriage } from "../lib/triage-rules.js";
import { triageGrayZone } from "../lib/triage-sonnet.js";
import { applyAcceptWithSnapshot } from "../lib/proposition-accept.js";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: "C:/Users/abrah/AhmetA/.env.local" });

const args = process.argv.slice(2);
const personaArg = args.find((a) => a.startsWith("--persona="))?.split("=")[1] || "nicolas-lavall-e";
const sourceFilter = args.find((a) => a.startsWith("--source="))?.split("=")[1] || null;
const maxArg = parseInt(args.find((a) => a.startsWith("--max="))?.split("=")[1] || "1000", 10);
const APPLY = args.includes("--apply");
const SONNET_BATCH_SIZE = 15;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("⚠ Missing ANTHROPIC_API_KEY — Sonnet gray zone will fall through to gray_zone (no auto-action).");
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

console.log(`=== Triage pending propositions (${APPLY ? "APPLY" : "DRY-RUN"}) ===\n`);
console.log(`Persona: ${personaArg}`);
console.log(`Source filter: ${sourceFilter || "(all)"}`);
console.log(`Max props: ${maxArg}\n`);

// 1. Resolve persona
const isUuid = /^[0-9a-f]{8}-/.test(personaArg);
const personaQ = sb.from("personas").select("id, name, slug");
const { data: persona } = isUuid
  ? await personaQ.eq("id", personaArg).maybeSingle()
  : await personaQ.eq("slug", personaArg).maybeSingle();
if (!persona) { console.error(`✗ Persona '${personaArg}' introuvable`); process.exit(1); }
console.log(`✓ Persona: ${persona.name} (${persona.id})\n`);

// 2. Resolve global doc
const { data: globalDoc } = await sb.from("protocol_document")
  .select("id").eq("owner_kind", "persona").eq("owner_id", persona.id)
  .is("source_core", null).eq("status", "active").single();
if (!globalDoc) { console.error("✗ Global protocol_document introuvable"); process.exit(1); }
console.log(`✓ Global doc: ${globalDoc.id}\n`);

// 3. Fetch pending propositions
let pendingQ = sb.from("proposition")
  .select("id, document_id, source, intent, target_kind, target_section_id, proposed_text, rationale, confidence, provenance")
  .eq("document_id", globalDoc.id)
  .eq("status", "pending")
  .order("confidence", { ascending: false })
  .limit(maxArg);

const { data: pending } = await pendingQ;
let propsToTriage = pending || [];
if (sourceFilter) {
  propsToTriage = propsToTriage.filter((p) =>
    (p.provenance?.playbook_sources || []).some((s) => s.source_core === sourceFilter)
    || p.source === sourceFilter
  );
}
console.log(`✓ ${propsToTriage.length} pending props to triage\n`);

// 4. Apply deterministic rules
const buckets = { auto_accept: [], auto_reject: [], gray_zone: [] };
for (const p of propsToTriage) {
  const d = decideTriage(p);
  buckets[d.decision].push({ ...p, _decision: d });
}
console.log(`Deterministic split:
  auto_accept: ${buckets.auto_accept.length}
  auto_reject: ${buckets.auto_reject.length}
  gray_zone:   ${buckets.gray_zone.length}`);

// 5. Sonnet on gray zone (in batches)
const grayDecisions = [];
if (anthropic && buckets.gray_zone.length > 0) {
  // Build section context once — used for all batches.
  const { data: sections } = await sb.from("protocol_section")
    .select("kind, prose").eq("document_id", globalDoc.id);
  const sectionContextByKind = Object.fromEntries((sections || []).map((s) => [s.kind, s.prose || ""]));

  for (let i = 0; i < buckets.gray_zone.length; i += SONNET_BATCH_SIZE) {
    const batch = buckets.gray_zone.slice(i, i + SONNET_BATCH_SIZE);
    console.log(`  Sonnet batch ${i / SONNET_BATCH_SIZE + 1} (${batch.length} props)...`);
    const decisions = await triageGrayZone({
      client: anthropic,
      propositions: batch,
      sectionContextByKind,
    });
    grayDecisions.push(...decisions);
  }
}
const grayAccepts = grayDecisions.filter((d) => d.decision === "accept").length;
const grayRejects = grayDecisions.filter((d) => d.decision === "reject").length;
const grayLeftPending = grayDecisions.filter((d) => d.decision === "gray_zone").length;
console.log(`\nGray zone Sonnet split:
  accept: ${grayAccepts}
  reject: ${grayRejects}
  left pending: ${grayLeftPending}\n`);

// 6. Summary + early exit if dry-run
const total = {
  to_accept: buckets.auto_accept.length + grayAccepts,
  to_reject: buckets.auto_reject.length + grayRejects,
  to_leave_pending: grayLeftPending,
};
console.log(`Final intent:
  ACCEPT: ${total.to_accept}
  REJECT: ${total.to_reject}
  LEAVE PENDING: ${total.to_leave_pending}\n`);

if (!APPLY) {
  console.log("(dry-run: no writes performed. Re-run with --apply to commit.)");
  process.exit(0);
}

// 7. APPLY accepts via the shared helper
let appliedAccepts = 0, failedAccepts = 0;
const applyOne = async (p, ruleName) => {
  const result = await applyAcceptWithSnapshot({
    supabase: sb, propositionId: p.id, isAutoAccepted: true, ruleName,
  });
  if (result.ok) { appliedAccepts++; }
  else { failedAccepts++; console.warn(`  ✗ accept failed for ${p.id}: ${result.step} / ${result.error}`); }
};

console.log("Applying deterministic auto-accepts...");
for (const p of buckets.auto_accept) {
  await applyOne(p, p._decision.rule_name);
}

console.log("Applying gray-zone Sonnet accepts...");
const byId = new Map(buckets.gray_zone.map((p) => [p.id, p]));
for (const d of grayDecisions) {
  if (d.decision === "accept") {
    const p = byId.get(d.id);
    if (p) await applyOne(p, "sonnet_gray_zone");
  }
}

// 8. APPLY rejects (no snapshot needed — just status update)
console.log("Applying rejects...");
let appliedRejects = 0;
const allRejectIds = [
  ...buckets.auto_reject.map((p) => p.id),
  ...grayDecisions.filter((d) => d.decision === "reject").map((d) => d.id),
];
for (let i = 0; i < allRejectIds.length; i += 50) {
  const slice = allRejectIds.slice(i, i + 50);
  const { error } = await sb.from("proposition")
    .update({ status: "rejected", resolved_at: new Date().toISOString() })
    .in("id", slice);
  if (!error) appliedRejects += slice.length;
}

// 9. Final report
console.log(`\n=== DONE ===
  Accepts applied:   ${appliedAccepts}
  Accepts failed:    ${failedAccepts}
  Rejects applied:   ${appliedRejects}
  Pending remaining: ${total.to_leave_pending}`);
```

- [ ] **Step 2: Run dry-run on Nicolas to validate counts**

```bash
node --env-file=.env.local scripts/triage-pending-propositions.js --persona=nicolas-lavall-e
```

Expected output: a clean summary like
```
Deterministic split:
  auto_accept: ~XXX
  auto_reject: ~XX
  gray_zone:   ~XXX

Final intent:
  ACCEPT: ~XXX
  REJECT: ~XX
  LEAVE PENDING: ~XX
```

If the numbers look insane (e.g. 0 accepts, or 350 rejects), STOP and revisit `decideTriage` thresholds.

- [ ] **Step 3: Spot-check 10 samples from each bucket**

Add a temporary `--print-samples` flag invocation (or a one-off node REPL) to print 10 random rows from each bucket with their decision rule. Manually verify the decision is reasonable.

- [ ] **Step 4: Commit script**

```bash
git add scripts/triage-pending-propositions.js
git commit -m "feat(triage): orchestrator script for pending proposition triage

Combines deterministic rules + Sonnet gray-zone + atomic accept helper.
Dry-run by default. Plan A 2026-05-03, Task 5."
```

- [ ] **Step 5: Apply on Nicolas (only after dry-run validated)**

```bash
node --env-file=.env.local scripts/triage-pending-propositions.js --persona=nicolas-lavall-e --apply
```

Expected: ~150-250 accepts, ~50-100 rejects, the rest pending. Verify in Supabase :

```sql
SELECT status, count(*), count(*) FILTER (WHERE is_auto_accepted) AS auto
FROM proposition
WHERE document_id = (SELECT id FROM protocol_document
  WHERE owner_id = (SELECT id FROM personas WHERE slug='nicolas-lavall-e')
    AND source_core IS NULL AND status='active')
GROUP BY status;
```

```sql
SELECT count(*) FROM protocol_artifact pa
JOIN protocol_section ps ON ps.id = pa.source_section_id
WHERE ps.document_id = (SELECT id FROM protocol_document
  WHERE owner_id = (SELECT id FROM personas WHERE slug='nicolas-lavall-e')
    AND source_core IS NULL AND status='active')
  AND pa.is_active = true;
```

Expected: artifact count grows from current baseline by ~150-250.

---

## Task 6: API endpoint /api/v2/propositions/revert

**Files:**
- Create: `api/v2/propositions/revert.js`
- Create: `test/v2-propositions-revert.test.js`

- [ ] **Step 1: Write failing test**

```js
// test/v2-propositions-revert.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

// We import the handler with mocked deps. The handler under test must
// support a `deps` 3rd arg (mirrors api/v2/propositions.js convention).
import handler from "../api/v2/propositions/revert.js";

function mockReqRes({ body, headers = {} } = {}) {
  return {
    req: { method: "POST", body, headers, query: {} },
    res: (() => {
      let _status = 200, _json = null;
      return {
        status(c) { _status = c; return this; },
        json(j) { _json = j; return this; },
        end() { return this; },
        get _called() { return { status: _status, json: _json }; },
      };
    })(),
  };
}

test("revert: nominal — restores prose_before, deactivates artifact, status=pending", async () => {
  const calls = { sectionUpdate: null, artifactUpdate: null, propUpdate: null, snapshotUpdate: null };
  const sb = {
    from(table) {
      const fluent = {
        select: () => fluent,
        eq: () => fluent,
        single: async () => {
          if (table === "proposition_revert_snapshot") return {
            data: { id: "snap1", proposition_id: "p1", section_id: "s1", artifact_id: "a1",
              prose_before: "Old", prose_after: "Old\n\nNew rule", reverted_at: null },
            error: null,
          };
          if (table === "protocol_section") return { data: { id: "s1", prose: "Old\n\nNew rule" }, error: null };
          if (table === "proposition") return { data: { id: "p1", document_id: "d1" }, error: null };
          if (table === "protocol_document") return { data: { owner_kind: "persona", owner_id: "u1" }, error: null };
          return { data: null, error: null };
        },
        update: (patch) => {
          if (table === "protocol_section") calls.sectionUpdate = patch;
          if (table === "protocol_artifact") calls.artifactUpdate = patch;
          if (table === "proposition") calls.propUpdate = patch;
          if (table === "proposition_revert_snapshot") calls.snapshotUpdate = patch;
          return { eq: () => ({ data: null, error: null }) };
        },
      };
      return fluent;
    },
  };

  const { req, res } = mockReqRes({
    body: { snapshot_id: "snap1" },
    headers: { authorization: "Bearer test" },
  });

  await handler(req, res, {
    supabase: sb,
    authenticateRequest: async () => ({ client: { id: "u1" }, isAdmin: true }),
    hasPersonaAccess: async () => true,
    setCors: () => {},
  });

  assert.equal(res._called.status, 200);
  assert.equal(calls.sectionUpdate.prose, "Old");
  assert.equal(calls.artifactUpdate.is_active, false);
  assert.equal(calls.propUpdate.status, "pending");
  assert.ok(calls.snapshotUpdate.reverted_at);
});

test("revert: conflict — section.prose has been modified since the snapshot", async () => {
  const sb = {
    from(table) {
      const fluent = {
        select: () => fluent, eq: () => fluent,
        single: async () => {
          if (table === "proposition_revert_snapshot") return {
            data: { id: "snap1", proposition_id: "p1", section_id: "s1", artifact_id: "a1",
              prose_before: "Old", prose_after: "Old\n\nNew rule", reverted_at: null },
            error: null,
          };
          // Section prose is now DIFFERENT from prose_after — someone else edited.
          if (table === "protocol_section") return { data: { id: "s1", prose: "Old\n\nNew rule\n\nAnother rule" }, error: null };
          if (table === "proposition") return { data: { id: "p1", document_id: "d1" }, error: null };
          if (table === "protocol_document") return { data: { owner_kind: "persona", owner_id: "u1" }, error: null };
          return { data: null, error: null };
        },
        update: () => ({ eq: () => ({ data: null, error: null }) }),
      };
      return fluent;
    },
  };
  const { req, res } = mockReqRes({ body: { snapshot_id: "snap1", force: false } });
  await handler(req, res, {
    supabase: sb,
    authenticateRequest: async () => ({ client: { id: "u1" }, isAdmin: true }),
    hasPersonaAccess: async () => true,
    setCors: () => {},
  });
  assert.equal(res._called.status, 409);
  assert.match(res._called.json.error, /conflict|modified/i);
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
node --test test/v2-propositions-revert.test.js
```

- [ ] **Step 3: Implement endpoint**

```js
// api/v2/propositions/revert.js
//
// POST /api/v2/propositions/revert
//   body: { snapshot_id: <uuid>, force?: boolean }
//   → 200 { reverted: true, snapshot_id }
//   → 409 { error: "section was modified since snapshot, pass force=true to overwrite" }
//
// Atomically (best-effort) :
//   1. fetch snapshot (must not be already reverted)
//   2. fetch section ; compare current prose to snapshot.prose_after
//      - if equal → safe, restore prose_before
//      - if different and !force → 409 conflict
//      - if different and force → restore anyway (caller chose to overwrite)
//   3. patch section.prose = prose_before
//   4. soft-deactivate the artifact (is_active=false)
//   5. update proposition status='pending', resolved_at=NULL
//   6. mark snapshot.reverted_at = now()

export const maxDuration = 15;

import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../../lib/supabase.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res, deps) {
  const {
    authenticateRequest = _authenticateRequest,
    hasPersonaAccess = _hasPersonaAccess,
    supabase = _supabase,
    setCors = _setCors,
  } = deps || {};

  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  let client, isAdmin;
  try { ({ client, isAdmin } = await authenticateRequest(req)); }
  catch (err) { res.status(err.status || 403).json({ error: err.error || "Auth failed" }); return; }

  const { snapshot_id, force = false } = req.body || {};
  if (!snapshot_id || !UUID_RE.test(snapshot_id)) {
    res.status(400).json({ error: "snapshot_id (uuid) required" }); return;
  }

  // 1. fetch snapshot
  const { data: snap } = await supabase
    .from("proposition_revert_snapshot")
    .select("id, proposition_id, section_id, artifact_id, prose_before, prose_after, reverted_at")
    .eq("id", snapshot_id)
    .single();
  if (!snap) { res.status(404).json({ error: "snapshot not found" }); return; }
  if (snap.reverted_at) { res.status(409).json({ error: "snapshot already reverted" }); return; }

  // Auth: walk snapshot → proposition → document → persona
  const { data: prop } = await supabase
    .from("proposition").select("id, document_id").eq("id", snap.proposition_id).single();
  if (!prop) { res.status(404).json({ error: "proposition not found" }); return; }
  const { data: doc } = await supabase
    .from("protocol_document").select("owner_kind, owner_id").eq("id", prop.document_id).single();
  if (!doc || doc.owner_kind !== "persona") { res.status(404).json({ error: "document not found" }); return; }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, doc.owner_id))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  // 2. fetch section, conflict check
  const { data: section } = await supabase
    .from("protocol_section").select("id, prose").eq("id", snap.section_id).single();
  if (!section) { res.status(404).json({ error: "section not found" }); return; }
  if ((section.prose || "") !== (snap.prose_after || "") && !force) {
    res.status(409).json({
      error: "section was modified since snapshot. Pass { force: true } to overwrite anyway.",
    });
    return;
  }

  // 3. restore prose
  await supabase.from("protocol_section")
    .update({ prose: snap.prose_before, author_kind: "proposition_reverted" })
    .eq("id", section.id);

  // 4. soft-deactivate artifact
  if (snap.artifact_id) {
    await supabase.from("protocol_artifact")
      .update({ is_active: false })
      .eq("id", snap.artifact_id);
  }

  // 5. proposition back to pending (so it can be re-triaged)
  await supabase.from("proposition")
    .update({ status: "pending", resolved_at: null, is_auto_accepted: false, accepted_by_rule: null })
    .eq("id", snap.proposition_id);

  // 6. mark snapshot reverted
  await supabase.from("proposition_revert_snapshot")
    .update({ reverted_at: new Date().toISOString() })
    .eq("id", snapshot_id);

  res.status(200).json({ reverted: true, snapshot_id });
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
node --test test/v2-propositions-revert.test.js
```

- [ ] **Step 5: Commit**

```bash
git add api/v2/propositions/revert.js test/v2-propositions-revert.test.js
git commit -m "feat(propositions): POST /api/v2/propositions/revert endpoint

Restores prose_before from a revert snapshot, soft-deactivates the
artifact, repassoir la proposition en pending. Conflict detection via
prose comparison ; force flag to override. Plan A 2026-05-03, Task 6."
```

---

## Task 7: getRecentAutoAccepts helper

**Files:**
- Modify: `lib/protocol-v2-db.js` (append at end)

- [ ] **Step 1: Add helper function**

Append at the end of `lib/protocol-v2-db.js`:

```js
/**
 * Lists recent auto-accepts for a persona, for the AutoAcceptReview UI.
 * Joins proposition + protocol_section + revert snapshot to give the UI
 * everything it needs to show a diff and offer "Annuler".
 *
 * @param {object} sb supabase client
 * @param {string} personaId
 * @param {object} [opts]
 * @param {number} [opts.limit=50]
 * @param {string} [opts.since] ISO date — if provided, only after this
 * @returns {Promise<Array<{
 *   snapshot_id: string,
 *   proposition_id: string,
 *   section_id: string,
 *   section_kind: string,
 *   artifact_id: string|null,
 *   prose_before: string,
 *   prose_after: string,
 *   applied_at: string,
 *   accepted_by_rule: string,
 *   intent: string,
 *   target_kind: string,
 *   proposed_text: string,
 *   confidence: number
 * }>>}
 */
export async function getRecentAutoAccepts(sb, personaId, { limit = 50, since = null } = {}) {
  // We need to constrain to the persona's documents. Easiest: fetch active
  // doc IDs for this persona, then filter on snapshot.section_id ∈ those docs.
  const { data: docs } = await sb.from("protocol_document")
    .select("id").eq("owner_kind", "persona").eq("owner_id", personaId).eq("status", "active");
  const docIds = (docs || []).map((d) => d.id);
  if (docIds.length === 0) return [];

  const { data: sections } = await sb.from("protocol_section")
    .select("id, kind").in("document_id", docIds);
  const sectionMap = new Map((sections || []).map((s) => [s.id, s.kind]));
  const sectionIds = [...sectionMap.keys()];
  if (sectionIds.length === 0) return [];

  let snapQ = sb.from("proposition_revert_snapshot")
    .select("id, proposition_id, section_id, artifact_id, prose_before, prose_after, applied_at")
    .in("section_id", sectionIds)
    .is("reverted_at", null)
    .order("applied_at", { ascending: false })
    .limit(limit);
  if (since) snapQ = snapQ.gte("applied_at", since);
  const { data: snaps } = await snapQ;
  if (!snaps || snaps.length === 0) return [];

  const { data: props } = await sb.from("proposition")
    .select("id, accepted_by_rule, intent, target_kind, proposed_text, confidence")
    .in("id", snaps.map((s) => s.proposition_id));
  const propMap = new Map((props || []).map((p) => [p.id, p]));

  return snaps.map((s) => {
    const p = propMap.get(s.proposition_id) || {};
    return {
      snapshot_id: s.id,
      proposition_id: s.proposition_id,
      section_id: s.section_id,
      section_kind: sectionMap.get(s.section_id) || null,
      artifact_id: s.artifact_id,
      prose_before: s.prose_before,
      prose_after: s.prose_after,
      applied_at: s.applied_at,
      accepted_by_rule: p.accepted_by_rule || null,
      intent: p.intent || null,
      target_kind: p.target_kind || null,
      proposed_text: p.proposed_text || null,
      confidence: p.confidence || null,
    };
  });
}
```

- [ ] **Step 2: Add an API route to expose it**

Modify `api/v2/protocol.js` (or create `api/v2/protocol/auto-accepts.js`) to expose `GET /api/v2/protocol/auto-accepts?persona=<id>&limit=50&since=<iso>`. Keep the same auth pattern as `propositions.js`.

```js
// api/v2/protocol/auto-accepts.js
import { authenticateRequest, hasPersonaAccess, supabase, setCors } from "../../../lib/supabase.js";
import { getRecentAutoAccepts } from "../../../lib/protocol-v2-db.js";

export const maxDuration = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  let client, isAdmin;
  try { ({ client, isAdmin } = await authenticateRequest(req)); }
  catch (err) { res.status(err.status || 403).json({ error: err.error || "Auth failed" }); return; }

  const personaId = req.query?.persona;
  if (!personaId || !UUID_RE.test(personaId)) {
    res.status(400).json({ error: "persona (uuid) required" }); return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, personaId))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const limit = Math.min(parseInt(req.query.limit || "50", 10) || 50, 200);
  const since = req.query.since || null;

  const items = await getRecentAutoAccepts(supabase, personaId, { limit, since });
  res.status(200).json({ items });
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/protocol-v2-db.js api/v2/protocol/auto-accepts.js
git commit -m "feat(protocol): getRecentAutoAccepts helper + GET /api/v2/protocol/auto-accepts

Backs the AutoAcceptReview UI with a single endpoint that returns the
last N auto-accepts joined with their snapshot and source proposition.
Plan A 2026-05-03, Task 7."
```

---

## Task 8: AutoAcceptReview UI component

**Files:**
- Create: `src/lib/components/protocol-v2/AutoAcceptCard.svelte`
- Create: `src/lib/components/protocol-v2/AutoAcceptReview.svelte`
- Modify: `src/lib/components/ProtocolPanel.svelte` (mount new tab)

- [ ] **Step 1: AutoAcceptCard component**

```svelte
<!-- src/lib/components/protocol-v2/AutoAcceptCard.svelte -->
<script>
  /**
   * @typedef {{
   *   snapshot_id: string,
   *   section_kind: string,
   *   accepted_by_rule: string,
   *   intent: string,
   *   target_kind: string,
   *   proposed_text: string,
   *   confidence: number,
   *   applied_at: string,
   *   prose_before: string,
   *   prose_after: string,
   * }} Item
   */
  /** @type {{ item: Item, onRevert: (snapshotId: string) => Promise<void> }} */
  let { item, onRevert } = $props();
  let busy = $state(false);
  let err = $state(null);

  // Highlight the diff between prose_before and prose_after — naive, just
  // displays the appended portion as the highlight.
  let appended = $derived.by(() => {
    if (!item.prose_after?.startsWith(item.prose_before || "")) return item.proposed_text || "";
    return item.prose_after.slice((item.prose_before || "").length).trim();
  });

  async function revert() {
    busy = true; err = null;
    try {
      await onRevert(item.snapshot_id);
    } catch (e) {
      err = e?.message || "revert failed";
    } finally {
      busy = false;
    }
  }
</script>

<div class="card">
  <div class="head">
    <span class="kind">{item.section_kind}</span>
    <span class="rule">{item.accepted_by_rule}</span>
    <span class="conf">conf {Math.round(item.confidence * 100)}%</span>
    <time>{new Date(item.applied_at).toLocaleString()}</time>
  </div>
  <div class="diff">
    <div class="appended">+ {appended}</div>
  </div>
  <div class="actions">
    <button type="button" disabled={busy} onclick={revert}>{busy ? "..." : "Annuler"}</button>
    {#if err}<span class="err">{err}</span>{/if}
  </div>
</div>

<style>
  .card { border: 1px solid var(--rule-strong); padding: 8px 12px; margin-bottom: 8px; background: var(--paper); }
  .head { display: flex; gap: 12px; font-size: 11px; color: var(--ink-40); margin-bottom: 6px; }
  .kind { font-weight: var(--fw-medium); color: var(--ink); }
  .diff { font-size: 13px; line-height: var(--lh-snug); margin-bottom: 8px; }
  .appended { color: var(--ink); background: color-mix(in srgb, var(--vermillon) 8%, transparent); padding: 4px 6px; }
  .actions { display: flex; gap: 8px; align-items: center; }
  button { padding: 4px 10px; border: 1px solid var(--rule-strong); background: var(--paper); cursor: pointer; }
  button:hover:not(:disabled) { background: var(--paper-subtle); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .err { color: var(--vermillon); font-size: 11px; }
</style>
```

- [ ] **Step 2: AutoAcceptReview component**

```svelte
<!-- src/lib/components/protocol-v2/AutoAcceptReview.svelte -->
<script>
  import { onMount } from "svelte";
  import AutoAcceptCard from "./AutoAcceptCard.svelte";
  /** @type {{ personaId: string }} */
  let { personaId } = $props();

  let items = $state([]);
  let loading = $state(true);
  let err = $state(null);
  let filter = $state("all"); // 'all' | 'high_confidence_simple' | 'doctrine_convergence' | 'sonnet_gray_zone'

  let filtered = $derived(filter === "all" ? items : items.filter((i) => i.accepted_by_rule === filter));

  async function load() {
    loading = true; err = null;
    try {
      const r = await fetch(`/api/v2/protocol/auto-accepts?persona=${personaId}&limit=100`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      items = j.items || [];
    } catch (e) {
      err = e?.message || "load failed";
    } finally {
      loading = false;
    }
  }
  onMount(load);

  async function revert(snapshotId) {
    const r = await fetch("/api/v2/propositions/revert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshot_id: snapshotId }),
    });
    if (r.status === 409) {
      const body = await r.json();
      const ok = window.confirm(`${body.error}\n\nForcer le revert ?`);
      if (!ok) throw new Error("annulé");
      const r2 = await fetch("/api/v2/propositions/revert", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ snapshot_id: snapshotId, force: true }),
      });
      if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
    } else if (!r.ok) {
      throw new Error(`HTTP ${r.status}`);
    }
    items = items.filter((i) => i.snapshot_id !== snapshotId);
  }
</script>

<div class="review">
  <header>
    <h3>Auto-accepts récents</h3>
    <select bind:value={filter}>
      <option value="all">Tous</option>
      <option value="high_confidence_simple">≥0.85 simple</option>
      <option value="doctrine_convergence">Convergence ≥2 playbooks</option>
      <option value="sonnet_gray_zone">Sonnet zone grise</option>
    </select>
    <button type="button" onclick={load}>↻</button>
  </header>

  {#if loading}<p>Chargement…</p>
  {:else if err}<p class="err">{err}</p>
  {:else if filtered.length === 0}<p class="empty">Aucun auto-accept à afficher.</p>
  {:else}
    {#each filtered as item (item.snapshot_id)}
      <AutoAcceptCard {item} onRevert={revert} />
    {/each}
  {/if}
</div>

<style>
  .review { padding: 12px; }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  h3 { font-size: 13px; margin: 0; flex: 1; }
  select, button { font: inherit; padding: 4px 8px; border: 1px solid var(--rule-strong); background: var(--paper); }
  .err { color: var(--vermillon); }
  .empty { color: var(--ink-40); font-size: 12px; }
</style>
```

- [ ] **Step 3: Wire into ProtocolPanel**

In `src/lib/components/ProtocolPanel.svelte`, find the existing tab structure and add a new tab "Auto-accepts" that mounts `<AutoAcceptReview personaId={...} />`. Pattern depends on the existing implementation — read first, then port the same tab convention.

- [ ] **Step 4: Manual smoke test**

Start the dev server :

```bash
npm run dev
```

Open the chat for Nicolas, navigate to the protocol panel, click the new "Auto-accepts" tab. Verify the list displays. Click "Annuler" on one item ; verify it disappears and the underlying section's prose loses the appended block.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/protocol-v2/AutoAcceptCard.svelte src/lib/components/protocol-v2/AutoAcceptReview.svelte src/lib/components/ProtocolPanel.svelte
git commit -m "feat(ui): AutoAcceptReview tab in ProtocolPanel

Lists recent auto-accepts with diff highlight and revert button. Filters
by accept rule. Plan A 2026-05-03, Task 8."
```

---

## Task 9: End-to-end live verification on Nicolas

**Files:** none — this task is pure verification.

- [ ] **Step 1: Pre-state snapshot**

Capture in a scratch file the current artifact count and a sample of section prose lengths, before triage runs :

```sql
SELECT count(*) AS artifact_count
FROM protocol_artifact pa
JOIN protocol_section ps ON ps.id = pa.source_section_id
JOIN protocol_document pd ON pd.id = ps.document_id
WHERE pd.owner_id = (SELECT id FROM personas WHERE slug='nicolas-lavall-e')
  AND pd.status = 'active' AND pa.is_active = true;

SELECT ps.kind, length(ps.prose) AS prose_len
FROM protocol_section ps
JOIN protocol_document pd ON pd.id = ps.document_id
WHERE pd.owner_id = (SELECT id FROM personas WHERE slug='nicolas-lavall-e')
  AND pd.status = 'active' AND pd.source_core IS NULL
ORDER BY ps.kind;
```

- [ ] **Step 2: Run triage script (apply mode)**

```bash
node --env-file=.env.local scripts/triage-pending-propositions.js --persona=nicolas-lavall-e --apply
```

Capture stdout to a log file for post-mortem.

- [ ] **Step 3: Post-state diff**

Re-run the SQL from Step 1. Compute the delta. Expect :
- artifact_count delta: ~+150 to +250
- prose_len delta on hard_rules / process / templates : significant growth

- [ ] **Step 4: Live chat sanity**

Open a fresh chat on Nicolas via the dev server. Send a generic message. Inspect the server log for `protocol_v2_decay_applied` or whatever assemble-prompt log exists ; confirm artifact count loaded into the prompt. (If the limit=30 is still in place from `getActiveArtifactsForPersona`, the chat will only see 30 — but at least they will be the *recent* ones from the triage. This is the intended hand-off point to Plan C.)

- [ ] **Step 5: AutoAcceptReview spot check**

Open the new Auto-accepts tab. Sample 10 items, manually judge whether each is a good accept. If you see >2/10 false positives, the triage thresholds need tightening — note them down for a follow-up tweak.

- [ ] **Step 6: Document outcome**

Append a short note (date + counts + qualitative assessment) to `docs/superpowers/plans/2026-05-03-proposition-triage-and-revert.md` under a new `## Execution Log` section.

---

## Self-Review

**Spec coverage:**
- ✅ Auto-accept conservateur des 379 pending → Tasks 2, 3, 5
- ✅ Snapshot + revert mechanism → Tasks 1, 3, 6
- ✅ UI revert pour annuler → Tasks 7, 8
- ✅ Sonnet pour zone grise → Task 4
- ✅ Verif live sur Nicolas → Task 9
- ⛔ Picker dynamique + suppression limite 30 → out of scope (Plan C)
- ⛔ Hygiène protocole (12 voice rules + 23k identity) → out of scope (Plan B)

**Type consistency:**
- `applyAcceptWithSnapshot` signature consistent across helper, refactored API endpoint, triage script ✓
- `triageGrayZone` returns `{ id, decision, reason }` consistent with what the orchestrator consumes ✓
- `getRecentAutoAccepts` return shape matches what `AutoAcceptReview` consumes ✓
- `decideTriage` rule names match the `accepted_by_rule` strings used in the script ✓

**Open assumptions to validate during execution:**
1. `protocol_artifact` table has `is_active` column (used in revert soft-deactivate). Verified earlier (cf `getActiveArtifactsForPersona` uses `.eq("is_active", true)`).
2. `proposition` status enum allows `pending` after a previous `accepted` state. Should — there's no DDL forbidding the transition. If the DB has a CHECK constraint forbidding this, Task 6 needs to use a different terminal status (`reverted`) and the triage skipping logic must include it.
3. `author_kind` enum on `protocol_section` accepts the new values `proposition_auto_accepted` and `proposition_reverted`. If it's a CHECK constraint, the migration in Task 1 needs a `DROP CONSTRAINT … ADD CONSTRAINT … WITH CHECK (author_kind IN (…))` extension.

**Coordination note for the parallel "refonte du cerveau" :**
This plan adds two columns + one table + one helper module that touches `proposition` / `protocol_section` / `protocol_artifact`. If the refonte changes the proposition lifecycle or the section model, expect conflicts in Task 3 (`applyAcceptWithSnapshot` and especially `patchProse`) and Task 6 (revert logic). The migration in Task 1 is purely additive and should survive most refactors — but if the proposition table is dropped/renamed, the FK constraints in `proposition_revert_snapshot` will need updating.

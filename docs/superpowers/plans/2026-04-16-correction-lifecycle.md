# Correction Lifecycle: Decay, Negative Feedback & Contradiction Detection

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add confidence decay, negative feedback, and contradiction detection to the correction/entity system so rules don't stay forever, bad rules can be demoted, and conflicting rules are flagged.

**Architecture:** Three independent changes that touch shared files. (1) Add `confidence` + `status` columns to `corrections` table, apply time-based decay when loading for prompt. (2) Add negative feedback path (API type + chat detection) that decreases entity/correction confidence. (3) Extend the existing `extractGraphKnowledge()` prompt to detect contradictions with existing style_rules, store as `contradicts` relations, and return them to callers.

**Tech Stack:** Supabase (Postgres), Node.js, Claude Haiku API, node:test

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `supabase/009_correction_lifecycle.sql` | Create | Migration: add `confidence`, `status` columns to corrections |
| `lib/knowledge-db.js` | Modify | Apply decay when loading corrections; filter by status/confidence |
| `lib/prompt.js` | Modify | Use correction confidence for ordering; show archived/low-conf rules differently |
| `lib/graph-extraction.js` | Modify | Add contradiction detection to extraction prompt |
| `lib/feedback-detect.js` | Modify | Add negative feedback detection function |
| `api/feedback.js` | Modify | Add `reject` type handler; decrease confidence |
| `api/chat.js` | Modify | Wire negative feedback detection in background |
| `test/prompt.test.js` | Modify | Add tests for decay and confidence-weighted ordering |
| `test/correction-lifecycle.test.js` | Create | Tests for decay math, negative feedback, contradiction detection |

---

## Chunk 1: Database Migration + Correction Confidence Decay

### Task 1: Migration — add `confidence` and `status` to corrections

**Files:**
- Create: `supabase/009_correction_lifecycle.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 009_correction_lifecycle.sql
-- Adds confidence scoring and lifecycle status to corrections

ALTER TABLE corrections
  ADD COLUMN IF NOT EXISTS confidence numeric(3,2) DEFAULT 0.8,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active'
    CHECK (status IN ('active', 'graduated', 'archived'));

CREATE INDEX IF NOT EXISTS idx_corrections_status
  ON corrections(persona_id, status) WHERE status = 'active';

-- Backfill: existing corrections get confidence 0.8
UPDATE corrections SET confidence = 0.8 WHERE confidence IS NULL;
UPDATE corrections SET status = 'active' WHERE status IS NULL;
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push` or apply manually via Supabase dashboard SQL editor.

- [ ] **Step 3: Commit**

```bash
git add supabase/009_correction_lifecycle.sql
git commit -m "feat: add confidence + status columns to corrections table"
```

### Task 2: Load corrections with decay and filtering

**Files:**
- Modify: `lib/knowledge-db.js:29-31` (loadPersonaData corrections query)
- Modify: `lib/knowledge-db.js:219-231` (getCorrectionsFromDb)

- [ ] **Step 1: Write the failing test**

Create `test/correction-lifecycle.test.js`:

```js
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

// We'll test the pure decay math + formatting logic
// extracted as a helper from knowledge-db.js

import { applyConfidenceDecay, formatCorrectionsWithDecay } from "../lib/correction-decay.js";

describe("applyConfidenceDecay", () => {
  it("returns full confidence for today's correction", () => {
    const result = applyConfidenceDecay(0.8, new Date().toISOString());
    assert.ok(result >= 0.75 && result <= 0.8);
  });

  it("decays over 120 days", () => {
    const d60ago = new Date(Date.now() - 60 * 86400000).toISOString();
    const result = applyConfidenceDecay(0.8, d60ago);
    assert.ok(result < 0.8, `expected < 0.8, got ${result}`);
    assert.ok(result > 0.3, `expected > 0.3, got ${result}`);
  });

  it("floors at 30% of original confidence", () => {
    const d200ago = new Date(Date.now() - 200 * 86400000).toISOString();
    const result = applyConfidenceDecay(0.8, d200ago);
    assert.equal(result, 0.24); // 0.8 * 0.3
  });

  it("high-confidence corrections decay slower", () => {
    const d60ago = new Date(Date.now() - 60 * 86400000).toISOString();
    const high = applyConfidenceDecay(1.0, d60ago);
    const low = applyConfidenceDecay(0.5, d60ago);
    assert.ok(high > low);
  });
});

describe("formatCorrectionsWithDecay", () => {
  it("filters out corrections below EFFECTIVE_FLOOR (0.15)", () => {
    const corrections = [
      { correction: "Rule A", created_at: new Date().toISOString(), confidence: 0.8, status: "active" },
      { correction: "Rule B", created_at: new Date(Date.now() - 200 * 86400000).toISOString(), confidence: 0.2, status: "active" },
    ];
    const result = formatCorrectionsWithDecay(corrections);
    assert.ok(result.includes("Rule A"));
    assert.ok(!result.includes("Rule B"));
  });

  it("sorts by effective confidence DESC", () => {
    const corrections = [
      { correction: "Old rule", created_at: new Date(Date.now() - 90 * 86400000).toISOString(), confidence: 0.8, status: "active" },
      { correction: "New rule", created_at: new Date().toISOString(), confidence: 0.8, status: "active" },
    ];
    const result = formatCorrectionsWithDecay(corrections);
    const oldIdx = result.indexOf("Old rule");
    const newIdx = result.indexOf("New rule");
    assert.ok(newIdx < oldIdx, "new rule should come first");
  });

  it("excludes archived corrections", () => {
    const corrections = [
      { correction: "Active", created_at: new Date().toISOString(), confidence: 0.8, status: "active" },
      { correction: "Archived", created_at: new Date().toISOString(), confidence: 0.8, status: "archived" },
    ];
    const result = formatCorrectionsWithDecay(corrections);
    assert.ok(result.includes("Active"));
    assert.ok(!result.includes("Archived"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/correction-lifecycle.test.js`
Expected: FAIL — module `../lib/correction-decay.js` not found

- [ ] **Step 3: Create the decay helper module**

Create `lib/correction-decay.js`:

```js
/**
 * Pure functions for correction confidence decay.
 * Decay window: 120 days. Floor: 30% of stored confidence.
 */

const DECAY_WINDOW_DAYS = 120;
const DECAY_FLOOR = 0.3;
const EFFECTIVE_FLOOR = 0.15; // below this, correction is hidden

/**
 * Compute effective confidence = stored_confidence * recency_factor.
 * recency_factor decays linearly from 1.0 to DECAY_FLOOR over DECAY_WINDOW_DAYS.
 */
export function applyConfidenceDecay(storedConfidence, createdAt) {
  const daysSince = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  const recencyFactor = Math.max(DECAY_FLOOR, 1.0 - (daysSince / DECAY_WINDOW_DAYS));
  return Math.round(storedConfidence * recencyFactor * 100) / 100;
}

/**
 * Format corrections with decay applied.
 * Filters out archived + low-confidence, sorts by effective confidence DESC.
 */
export function formatCorrectionsWithDecay(corrections) {
  if (!corrections || corrections.length === 0) return null;

  const scored = corrections
    .filter(c => c.status !== "archived")
    .map(c => ({
      ...c,
      effectiveConf: applyConfidenceDecay(c.confidence ?? 0.8, c.created_at),
    }))
    .filter(c => c.effectiveConf >= EFFECTIVE_FLOOR)
    .sort((a, b) => b.effectiveConf - a.effectiveConf);

  if (scored.length === 0) return null;

  let md = "# Corrections apprises\n\n";
  for (const c of scored) {
    const date = new Date(c.created_at).toISOString().split("T")[0];
    md += `- **${date}** — ${c.correction}\n`;
    if (c.user_message) md += `  - Contexte: "${c.user_message.slice(0, 100)}"\n`;
    if (c.bot_message) md += `  - Reponse: "${c.bot_message.slice(0, 150)}"\n`;
  }
  return md;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/correction-lifecycle.test.js`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/correction-decay.js test/correction-lifecycle.test.js
git commit -m "feat: add correction confidence decay with pure helper functions"
```

### Task 3: Wire decay into knowledge-db.js

**Files:**
- Modify: `lib/knowledge-db.js:29-31` (loadPersonaData — include new columns in query)
- Modify: `lib/knowledge-db.js:219-231` (getCorrectionsFromDb — use decay formatting)

- [ ] **Step 1: Update loadPersonaData to select new columns**

In `lib/knowledge-db.js:30`, change the corrections query:

```js
// Before:
const { data: corrections } = await supabase
  .from("corrections").select("id, correction, user_message, bot_message, created_at")
  .eq("persona_id", personaId).order("created_at", { ascending: true });

// After:
const { data: corrections } = await supabase
  .from("corrections").select("id, correction, user_message, bot_message, confidence, status, created_at")
  .eq("persona_id", personaId).order("created_at", { ascending: true });
```

- [ ] **Step 2: Replace getCorrectionsFromDb with decay-aware version**

In `lib/knowledge-db.js`, replace `getCorrectionsFromDb`:

```js
// Before (lines 219-231):
export async function getCorrectionsFromDb(personaId) {
  const data = await loadPersonaData(personaId);
  if (!data || data.corrections.length === 0) return null;
  let md = "# Corrections apprises\n\n";
  for (const c of data.corrections) {
    const date = new Date(c.created_at).toISOString().split("T")[0];
    md += `- **${date}** — ${c.correction}\n`;
    if (c.user_message) md += `  - Contexte: "${c.user_message.slice(0, 100)}"\n`;
    if (c.bot_message) md += `  - Reponse: "${c.bot_message.slice(0, 150)}"\n`;
  }
  return md;
}

// After:
import { formatCorrectionsWithDecay } from "./correction-decay.js";

export async function getCorrectionsFromDb(personaId) {
  const data = await loadPersonaData(personaId);
  if (!data || data.corrections.length === 0) return null;
  return formatCorrectionsWithDecay(data.corrections);
}
```

- [ ] **Step 3: Run existing prompt tests to verify no regression**

Run: `node --test test/prompt.test.js`
Expected: PASS (all existing tests still pass — corrections format is compatible)

- [ ] **Step 4: Commit**

```bash
git add lib/knowledge-db.js
git commit -m "feat: wire correction decay into knowledge-db loading"
```

---

## Chunk 2: Negative Feedback

### Task 4: Add negative feedback detection

**Files:**
- Modify: `lib/feedback-detect.js` (add `detectNegativeFeedback` function)

- [ ] **Step 1: Write the failing test**

Add to `test/correction-lifecycle.test.js`:

```js
import { looksLikeNegativeFeedback } from "../lib/feedback-detect.js";

describe("looksLikeNegativeFeedback", () => {
  it("detects 'oublie cette regle'", () => {
    assert.ok(looksLikeNegativeFeedback("oublie cette regle"));
  });

  it("detects 'c'etait mieux avant'", () => {
    assert.ok(looksLikeNegativeFeedback("c'etait mieux avant"));
  });

  it("detects 'annule la derniere correction'", () => {
    assert.ok(looksLikeNegativeFeedback("annule la derniere correction"));
  });

  it("rejects normal messages", () => {
    assert.ok(!looksLikeNegativeFeedback("Envoie un message a Sophie"));
  });

  it("rejects long messages", () => {
    assert.ok(!looksLikeNegativeFeedback("oublie cette regle " + "x".repeat(300)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/correction-lifecycle.test.js`
Expected: FAIL — `looksLikeNegativeFeedback` not exported

- [ ] **Step 3: Add the detection function**

In `lib/feedback-detect.js`, add after the existing patterns (around line 30):

```js
/**
 * Negative feedback signals — user wants to undo/weaken a rule.
 * e.g. "oublie cette regle", "c'etait mieux avant", "annule", "reviens en arriere"
 */
const NEGATIVE_PATTERN = /\b(oublie[sr]?\s+(cette|la|ma|les|des)\s+(r[èe]gle|correction|instruction)|annule[sr]?\s+(la\s+derni[èe]re|cette|les)|c'[ée]tait\s+mieux\s+avant|reviens?\s+en\s+arri[èe]re|supprime[sr]?\s+(cette|la|les)\s+(r[èe]gle|correction)|retire[sr]?\s+(cette|la|les)\s+(r[èe]gle|correction)|non\s+c'est\s+pas\s+[çc]a|c'est\s+pas\s+ce\s+que\s+j|enleve[sr]?\s+(cette|la|les)\s+(r[èe]gle|correction))\b/i;

const MAX_NEGATIVE_LENGTH = 200;

export function looksLikeNegativeFeedback(msg) {
  if (!msg || msg.length > MAX_NEGATIVE_LENGTH) return false;
  return NEGATIVE_PATTERN.test(msg);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/correction-lifecycle.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/feedback-detect.js test/correction-lifecycle.test.js
git commit -m "feat: add negative feedback detection pattern"
```

### Task 5: Add negative feedback processing

**Files:**
- Modify: `lib/feedback-detect.js` (add full `detectNegativeFeedback` async function)

- [ ] **Step 1: Add the async processing function**

In `lib/feedback-detect.js`, add after `looksLikeNegativeFeedback`:

```js
/**
 * Process negative feedback: identify which correction/entity to demote.
 * Uses Haiku to match the user's message against recent corrections.
 * Returns { demoted: number, corrections: string[] } or null.
 */
export async function detectNegativeFeedback(personaId, userMsg, conversationMessages, client) {
  if (!userMsg || userMsg.length > MAX_NEGATIVE_LENGTH) return null;
  if (!NEGATIVE_PATTERN.test(userMsg)) return null;
  if (!conversationMessages || conversationMessages.length < 2) return null;

  try {
    const apiKey = getApiKey(client);
    const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

    // Load recent corrections for this persona
    const { data: corrections } = await supabase
      .from("corrections")
      .select("id, correction, confidence, created_at")
      .eq("persona_id", personaId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(20);

    if (!corrections || corrections.length === 0) return null;

    const corrList = corrections.map((c, i) => `[${i}] ${c.correction}`).join("\n");
    const recentMessages = conversationMessages.slice(-6)
      .map(m => `${m.role === "user" ? "USER" : "BOT"}: ${(m.content || "").slice(0, 200)}`)
      .join("\n\n");

    const result = await Promise.race([
      anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        system: `L'utilisateur veut annuler ou affaiblir une regle de son clone IA.
Voici les corrections actives :
${corrList}

Identifie quelle(s) correction(s) l'utilisateur veut annuler/affaiblir.
Reponds en JSON : {"indices": [0, 2], "reason": "explication courte"}
Si aucune ne correspond, reponds {"indices": [], "reason": "aucune correspondance"}`,
        messages: [{
          role: "user",
          content: `Conversation :\n${recentMessages}\n\nDernier message : "${userMsg}"`,
        }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
    ]);

    const raw = result.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    let data;
    try { data = JSON.parse(jsonMatch[0]); } catch { return null; }
    if (!data.indices?.length) return null;

    const demoted = [];
    for (const idx of data.indices) {
      if (idx < 0 || idx >= corrections.length) continue;
      const c = corrections[idx];
      const newConf = Math.max(0.0, (c.confidence || 0.8) - 0.2);
      const newStatus = newConf <= 0.1 ? "archived" : "active";

      await supabase.from("corrections")
        .update({ confidence: newConf, status: newStatus })
        .eq("id", c.id);

      // Also demote matching entities
      const { data: entities } = await supabase
        .from("knowledge_entities")
        .select("id, name, confidence")
        .eq("persona_id", personaId);

      if (entities?.length) {
        const corrLower = c.correction.toLowerCase();
        const matched = entities.filter(e => corrLower.includes(e.name.toLowerCase()));
        for (const e of matched) {
          const entConf = Math.max(0.0, (e.confidence || 0.8) - 0.15);
          await supabase.from("knowledge_entities")
            .update({ confidence: entConf })
            .eq("id", e.id);
        }
      }

      demoted.push(c.correction);
    }

    if (demoted.length > 0) clearCache(personaId);

    console.log(JSON.stringify({
      event: "negative_feedback_detected",
      ts: new Date().toISOString(),
      persona: personaId,
      demoted_count: demoted.length,
      trigger: userMsg.slice(0, 50),
    }));

    return { demoted: demoted.length, corrections: demoted };
  } catch (e) {
    console.log(JSON.stringify({
      event: "negative_feedback_error",
      ts: new Date().toISOString(),
      persona: personaId,
      error: e.message,
    }));
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/feedback-detect.js
git commit -m "feat: add negative feedback processing with confidence demotion"
```

### Task 6: Add `reject` type to feedback API

**Files:**
- Modify: `api/feedback.js` (add handler after `validate` type, around line 155)

- [ ] **Step 1: Add the reject handler**

In `api/feedback.js`, after the `validate` type block (after line 155), add:

```js
  // ── Type "reject": negative reinforcement — demote specific entities/corrections ──
  // Frontend sends entityIds[] and/or correctionIds[] to demote explicitly.
  if (type === "reject") {
    const { entityIds, correctionIds } = req.body || {};
    if (!entityIds?.length && !correctionIds?.length) {
      res.status(400).json({ error: "entityIds or correctionIds required" }); return;
    }

    let demotedEntities = 0;
    let demotedCorrections = 0;

    // Demote specific entities by ID
    if (entityIds?.length > 0) {
      for (const id of entityIds) {
        const { data: entity } = await supabase
          .from("knowledge_entities")
          .select("confidence")
          .eq("id", id).eq("persona_id", personaId).single();
        if (!entity) continue;
        const newConf = Math.max(0.0, (entity.confidence || 0.8) - 0.1);
        await supabase.from("knowledge_entities")
          .update({ confidence: newConf, last_matched_at: new Date().toISOString() })
          .eq("id", id);
        demotedEntities++;
      }
    }

    // Demote specific corrections by ID
    if (correctionIds?.length > 0) {
      for (const id of correctionIds) {
        const { data: corr } = await supabase
          .from("corrections")
          .select("confidence")
          .eq("id", id).eq("persona_id", personaId).single();
        if (!corr) continue;
        const newConf = Math.max(0.0, (corr.confidence || 0.8) - 0.15);
        const newStatus = newConf <= 0.1 ? "archived" : "active";
        await supabase.from("corrections")
          .update({ confidence: newConf, status: newStatus })
          .eq("id", id);
        demotedCorrections++;
      }
    }

    clearCache(personaId);
    res.json({ ok: true, message: "Rejected", entities_demoted: demotedEntities, corrections_demoted: demotedCorrections });
    return;
  }
```

- [ ] **Step 2: Commit**

```bash
git add api/feedback.js
git commit -m "feat: add reject type to feedback API for entity demotion"
```

### Task 7: Wire negative detection into chat.js

**Files:**
- Modify: `api/chat.js:8` (import)
- Modify: `api/chat.js:143-177` (short-circuit path)
- Modify: `api/chat.js:213-218` (background detection)

- [ ] **Step 1: Add import**

In `api/chat.js:8`, add `detectNegativeFeedback` and `looksLikeNegativeFeedback` to the import:

```js
import { detectChatFeedback, detectDirectInstruction, detectCoachingCorrection, looksLikeDirectInstruction, looksLikeNegativeFeedback, detectNegativeFeedback } from "../lib/feedback-detect.js";
```

- [ ] **Step 2: Add negative feedback short-circuit before the instruction short-circuit**

In `api/chat.js`, before the existing `if (looksLikeDirectInstruction(message))` block (line 145), add:

```js
  // Short-circuit: negative feedback — user wants to undo/weaken a rule
  if (looksLikeNegativeFeedback(message)) {
    try {
      const result = await detectNegativeFeedback(personaId, message, messages, client);
      if (result && result.demoted > 0) {
        const confirm = result.demoted === 1
          ? `Règle affaiblie : "${result.corrections[0].slice(0, 60)}". Elle aura moins d'influence.`
          : `${result.demoted} règles affaiblies. Elles auront moins d'influence.`;
        sse("delta", { text: confirm });
        sse("done", {});

        if (convId && supabase) {
          Promise.all([
            supabase.from("messages").insert([
              { conversation_id: convId, role: "user", content: message },
              { conversation_id: convId, role: "assistant", content: confirm },
            ]),
            supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId),
            supabase.from("conversations")
              .update({ title: extractConvTitle(message, scenario) })
              .eq("id", convId).is("title", null),
          ]).catch(() => {});
        }

        if (convId) sse("conversation", { id: convId });
        res.end();
        return;
      }
    } catch (e) {
      console.log(JSON.stringify({ event: "negative_feedback_shortcircuit_error", ts: new Date().toISOString(), error: e.message }));
    }
  }
```

- [ ] **Step 3: Run existing tests**

Run: `node --test test/prompt.test.js && node --test test/correction-lifecycle.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add api/chat.js
git commit -m "feat: wire negative feedback detection into chat flow"
```

---

## Chunk 3: Contradiction Detection

### Task 8: Extend graph extraction prompt for contradictions

**Files:**
- Modify: `lib/graph-extraction.js:4-28` (GRAPH_EXTRACTION_PROMPT)
- Modify: `lib/graph-extraction.js:36-129` (extractGraphKnowledge return value)

- [ ] **Step 1: Update the extraction prompt**

In `lib/graph-extraction.js`, replace `GRAPH_EXTRACTION_PROMPT` (lines 4-28):

```js
export const GRAPH_EXTRACTION_PROMPT = `Tu es un expert en extraction de connaissances pour un clone de voix IA.
Un utilisateur vient de corriger une reponse de son clone. Analyse sa correction et extrais TOUT ce qui peut ameliorer le clone :

1. Regles de style (ton, longueur, formulation, mots interdits, expressions preferees)
2. Concepts metier (frameworks, methodologies, croyances, outils)
3. Preferences relationnelles (tutoiement, niveau de formalite, emoticons)
4. Connaissances domaine (faits, metriques, personnes, entreprises)

Types d'entites : concept, framework, person, company, metric, belief, tool, style_rule
Types de relations : equals, includes, contradicts, causes, uses, prerequisite, enforces

IMPORTANT : Les corrections de STYLE sont aussi importantes que les corrections de fond.
"Trop formel" → entite style_rule "tutoiement obligatoire"
"Trop long" → entite style_rule "messages courts (5-15 mots)"
"Pas assez direct" → entite style_rule "aller droit au but"

DETECTION DE CONTRADICTIONS :
Compare la nouvelle correction avec les entites existantes (surtout les style_rule).
Si la nouvelle correction CONTREDIT une regle existante, ajoute une relation "contradicts".
Exemples :
- Existant: "tutoiement obligatoire" + Nouvelle: "vouvoyer les nouveaux contacts" → contradicts
- Existant: "messages courts (5-15 mots)" + Nouvelle: "reponses detaillees et completes" → contradicts
- Existant: "ton decontracte" + Nouvelle: "ton professionnel formel" → contradicts

Reponds en JSON :
{
  "has_graph_update": true/false,
  "new_entities": [{ "name": "...", "type": "...", "description": "..." }],
  "new_relations": [{ "from": "...", "to": "...", "type": "...", "description": "..." }],
  "updated_entities": [{ "name": "...", "description": "nouvelle description" }],
  "contradictions": [{ "new_rule": "...", "existing_rule": "...", "description": "explication de la contradiction" }]
}

Reponds {"has_graph_update": false} UNIQUEMENT si la correction est vide ou incomprehensible.`;
```

- [ ] **Step 2: Rewrite extractGraphKnowledge to unify return type**

The function currently has 5 different return points (lines 65, 74, 112, 121, 124) all returning `number`. We must unify ALL of them to `{ entityCount, contradictions }`.

Replace the entire function body in `lib/graph-extraction.js` (lines 36-129):

```js
export async function extractGraphKnowledge(personaId, correctionText, botMsg, userMsg, client) {
  const EMPTY = { entityCount: 0, contradictions: [] };
  try {
    const apiKey = getApiKey(client);
    const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

    const { data: existingEntities } = await supabase
      .from("knowledge_entities")
      .select("name, type, description")
      .eq("persona_id", personaId);

    const entityContext = existingEntities?.length > 0
      ? `\n\nEntites existantes dans le graphe :\n${existingEntities.map(e => `- ${e.name} (${e.type}): ${e.description}`).join("\n")}`
      : "";

    const result = await Promise.race([
      anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: GRAPH_EXTRACTION_PROMPT + entityContext,
        messages: [{
          role: "user",
          content: `Correction du client : "${correctionText}"\n\nContexte — message bot : "${(botMsg || "").slice(0, 200)}"\nMessage user : "${(userMsg || "").slice(0, 200)}"`,
        }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
    ]);

    const raw = result.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return EMPTY;

    let graphData;
    try {
      graphData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.log(JSON.stringify({ event: "graph_extraction_json_error", persona: personaId, error: parseErr.message }));
      return EMPTY;
    }
    if (!graphData.has_graph_update) return EMPTY;

    const contradictions = graphData.contradictions || [];
    let entityCount = 0;

    if (graphData.new_entities?.length > 0) {
      const entityRows = graphData.new_entities.map(e => ({
        persona_id: personaId,
        name: e.name,
        type: VALID_ENTITY_TYPES.has(e.type) ? e.type : "concept",
        description: e.description || "",
        confidence: 0.8,
      }));

      const { data: inserted } = await supabase
        .from("knowledge_entities")
        .upsert(entityRows, { onConflict: "persona_id,name" })
        .select("id, name");

      entityCount = inserted?.length || 0;

      if (inserted?.length > 0 && graphData.new_relations?.length > 0) {
        const { data: allEntities } = await supabase
          .from("knowledge_entities").select("id, name").eq("persona_id", personaId);
        const entityMap = {};
        for (const e of (allEntities || [])) entityMap[e.name] = e.id;

        const relationRows = graphData.new_relations
          .filter(r => entityMap[r.from] && entityMap[r.to])
          .map(r => ({
            persona_id: personaId,
            from_entity_id: entityMap[r.from],
            to_entity_id: entityMap[r.to],
            relation_type: VALID_RELATION_TYPES.has(r.type) ? r.type : "uses",
            description: r.description || "",
            confidence: 0.8,
          }));
        if (relationRows.length > 0) {
          await supabase.from("knowledge_relations").insert(relationRows);
        }
      }

      // Handle contradictions — fuzzy match LLM names against existing entities
      if (contradictions.length > 0) {
        const { data: allEnt } = await supabase
          .from("knowledge_entities").select("id, name").eq("persona_id", personaId);
        const entList = allEnt || [];

        for (const c of contradictions) {
          // Fuzzy match: find entity whose name is contained in (or contains) the LLM's text
          const findEntity = (text) => {
            if (!text) return null;
            const lower = text.toLowerCase();
            return entList.find(e => lower.includes(e.name.toLowerCase()) || e.name.toLowerCase().includes(lower));
          };
          const fromEnt = findEntity(c.new_rule);
          const toEnt = findEntity(c.existing_rule);
          if (fromEnt && toEnt && fromEnt.id !== toEnt.id) {
            await supabase.from("knowledge_relations").insert({
              persona_id: personaId,
              from_entity_id: fromEnt.id,
              to_entity_id: toEnt.id,
              relation_type: "contradicts",
              description: c.description || "",
              confidence: 0.9,
            });
          }
        }
      }
    }

    if (entityCount === 0 && graphData.updated_entities?.length > 0) {
      for (const upd of graphData.updated_entities) {
        await supabase.from("knowledge_entities")
          .update({ description: upd.description })
          .eq("persona_id", personaId).eq("name", upd.name);
      }
      entityCount = graphData.updated_entities.length;
    }

    return { entityCount, contradictions };
  } catch (e) {
    console.log(JSON.stringify({ event: "graph_extraction_error", persona: personaId, error: e.message }));
    return { entityCount: 0, contradictions: [] };
  }
}
```

Key changes vs. original:
- **All return paths** now return `{ entityCount, contradictions }` (including error/early exits via `EMPTY`)
- **Contradiction matching** uses bidirectional `includes()` instead of exact name match
- **No more early returns** inside the new_entities/updated_entities branches — single return at end

- [ ] **Step 3: Update callers to handle new return type**

The return value of `extractGraphKnowledge` is used in:
- `lib/feedback-detect.js` lines 141, 218, 300 — ignores return value (just awaits)
- `api/feedback.js` line 212 — fire-and-forget (`.catch(() => {})`)
- `api/feedback.js` line 252 — awaits but ignores
- `api/feedback.js` line 305 — uses return as `entityCount`

Only `api/feedback.js:305` needs updating (return is now always `{ entityCount, contradictions }`):

```js
// Before:
const entityCount = await extractGraphKnowledge(personaId, finalCorrection, botMessage || original, userMessage, client);
// ...
res.json({ ok: true, message: "Correction enregistree", entities_extracted: entityCount });

// After:
const { entityCount, contradictions } = await extractGraphKnowledge(personaId, finalCorrection, botMessage || original, userMessage, client);
// ...
res.json({
  ok: true,
  message: "Correction enregistree",
  entities_extracted: entityCount,
  contradictions: contradictions.length > 0 ? contradictions : undefined,
});
```

- [ ] **Step 4: Run all tests**

Run: `node --test test/prompt.test.js && node --test test/correction-lifecycle.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/graph-extraction.js api/feedback.js
git commit -m "feat: add contradiction detection to graph extraction"
```

### Task 9: Surface contradictions in the Intelligence panel API

**Files:**
- Modify: `api/feedback.js:39-76` (GET handler — add contradictions to response)

- [ ] **Step 1: Add contradictions to the GET response**

In `api/feedback.js` GET handler, after building `entities` (around line 56), add:

```js
    // Find contradiction relations
    const contradictions = data.relations
      .filter(r => r.relation_type === "contradicts")
      .map(r => ({
        from: entityMap[r.from_entity_id] || "?",
        to: entityMap[r.to_entity_id] || "?",
        description: r.description,
        confidence: r.confidence,
      }));
```

Then add `contradictions` to the response object (around line 67):

```js
    res.json({
      stats: {
        corrections_total: data.corrections.length,
        entities_total: entities.length,
        relations_total: data.relations.length,
        confidence_avg: confidenceAvg,
        contradictions_count: contradictions.length,
      },
      corrections,
      entities,
      contradictions,
    });
```

- [ ] **Step 2: Commit**

```bash
git add api/feedback.js
git commit -m "feat: surface contradictions in Intelligence panel API"
```

### Task 10: Final integration test

- [ ] **Step 1: Run all tests**

Run: `node --test test/prompt.test.js && node --test test/correction-lifecycle.test.js`
Expected: ALL PASS

- [ ] **Step 2: Verify the full flow manually**

1. Start dev server
2. Send a correction: "ajoute une regle : toujours tutoyer"
3. Verify correction saved with confidence 0.8 in DB
4. Send contradicting correction: "ajoute une regle : vouvoyer les nouveaux contacts"
5. Check Intelligence panel API — should show contradiction
6. Send "oublie la regle du tutoiement"
7. Verify correction confidence decreased

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete correction lifecycle — decay, negative feedback, contradictions"
```

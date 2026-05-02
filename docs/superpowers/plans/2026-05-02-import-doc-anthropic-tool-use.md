# Doc-Import Recall Fix — Anthropic tool_use Union Extractor

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Haiku router + per-target Sonnet extractor pipeline (used only on the `operational_playbook`/`generic` doc-import path) with a single Sonnet tool_use call per chunk that emits an array of typed propositions discriminated by `target_kind`. Sonnet self-routes per-item, eliminating the chunk-level gate that currently filters out prose narrative (1/4 chunks routed on Nicolas's process-setter.md).

**Architecture:** Add one new file `lib/protocol-v2-doc-extractor.js` exposing `extractFromChunk(chunk, ctx, opts)` that calls Anthropic's Messages API with a single `emit_propositions` tool whose `input_schema` accepts an array of items each tagged with a `target_kind` enum literal. `tool_choice` forces invocation. Output normalized to the same `[{target_kind, proposal}]` shape that `routeAndExtract` returns today, so the call site in `import-doc.js` swaps in cleanly. The 6 individual per-target extractors (`lib/protocol-v2-extractors/*`) and `routeAndExtract` STAY UNCHANGED — they remain in use for feedback-event consolidation, rule_saved/dismissed, and the explicit `extractTargets` array path in import-doc.js (PR #215). Only the `null` extractTargets path (operational_playbook, generic) switches.

**Tech Stack:**
- `@anthropic-ai/sdk` 0.91.x (already installed) — `messages.create` with `tools` + `tool_choice`
- Node.js test runner (`node --test`) — existing pattern in `test/*.test.js`
- Voyage embeddings + Supabase merge layer unchanged
- claude-sonnet-4-6 model, 60s function timeout (Vercel `maxDuration`)

---

## Chunk 1: New extractor module + unit tests

### Task 1: Define the extractor module shell and exports

**Files:**
- Create: `lib/protocol-v2-doc-extractor.js`

- [ ] **Step 1: Write the failing test for `normalizeBatchOutput` (pure validator)**

Create `test/protocol-v2-doc-extractor.test.js`:

```javascript
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { normalizeBatchOutput } from "../lib/protocol-v2-doc-extractor.js";

describe("normalizeBatchOutput", () => {
  it("returns [] for null/non-object input", () => {
    assert.deepEqual(normalizeBatchOutput(null), []);
    assert.deepEqual(normalizeBatchOutput("foo"), []);
    assert.deepEqual(normalizeBatchOutput({ propositions: "not array" }), []);
  });

  it("filters items with invalid target_kind", () => {
    const raw = {
      propositions: [
        { target_kind: "hard_rules", intent: "add_rule", proposed_text: "Max 6 lignes par message.", confidence: 0.9 },
        { target_kind: "garbage", intent: "add_rule", proposed_text: "x", confidence: 0.9 },
        { target_kind: "identity", intent: "add_rule", proposed_text: "x", confidence: 0.9 }, // identity not extractable
      ],
    };
    const out = normalizeBatchOutput(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].target_kind, "hard_rules");
  });

  it("clamps confidence to [0,1] and rounds to 2 decimals", () => {
    const out = normalizeBatchOutput({
      propositions: [
        { target_kind: "errors", intent: "add_pair", proposed_text: "Eviter X — préférer Y", confidence: 1.5 },
        { target_kind: "errors", intent: "add_pair", proposed_text: "A — B", confidence: -0.2 },
        { target_kind: "errors", intent: "add_pair", proposed_text: "C — D", confidence: 0.876543 },
      ],
    });
    assert.equal(out[0].proposal.confidence, 1);
    assert.equal(out[1].proposal.confidence, 0);
    assert.equal(out[2].proposal.confidence, 0.88);
  });

  it("trims proposed_text and drops items below MIN/above MAX length", () => {
    const out = normalizeBatchOutput({
      propositions: [
        { target_kind: "hard_rules", intent: "add_rule", proposed_text: "  ok  ", confidence: 0.8 }, // too short after trim
        { target_kind: "hard_rules", intent: "add_rule", proposed_text: "x".repeat(401), confidence: 0.8 }, // too long
        { target_kind: "hard_rules", intent: "add_rule", proposed_text: "Max 6 lignes par message.", confidence: 0.8 },
      ],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].proposal.proposed_text, "Max 6 lignes par message.");
  });

  it("returns shape {target_kind, proposal:{intent,proposed_text,rationale,confidence,target_kind}}", () => {
    const out = normalizeBatchOutput({
      propositions: [
        { target_kind: "icp_patterns", intent: "add_pattern", proposed_text: "Founder solo SaaS B2B 1-10 employés", rationale: "doc cite ICP P1 explicit", confidence: 0.85 },
      ],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].target_kind, "icp_patterns");
    assert.equal(out[0].proposal.target_kind, "icp_patterns");
    assert.equal(out[0].proposal.intent, "add_pattern");
    assert.equal(out[0].proposal.proposed_text, "Founder solo SaaS B2B 1-10 employés");
    assert.equal(out[0].proposal.rationale, "doc cite ICP P1 explicit");
    assert.equal(out[0].proposal.confidence, 0.85);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/protocol-v2-doc-extractor.test.js`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Create the file shell with `normalizeBatchOutput` only**

Create `lib/protocol-v2-doc-extractor.js`:

```javascript
// Single-call Sonnet tool_use extractor for protocol v2 doc-import.
//
// Replaces the Haiku-router + per-target-Sonnet pipeline ONLY for the
// operational_playbook / generic doc_kind path (where the router was
// gating prose chunks and returning []).
//
// API :
//   await extractFromChunk(chunk, ctx, opts)
//     → Array<{target_kind, proposal}>
//
//   normalizeBatchOutput(raw) — pure validator, exported for tests.

const TARGET_KINDS = new Set([
  "hard_rules",
  "errors",
  "icp_patterns",
  "scoring",
  "process",
  "templates",
]);

const VALID_INTENTS = new Set([
  // intents are intentionally permissive — the per-kind extractors enforce
  // tighter intent vocabularies, but here we accept any verb-ish intent
  // and let the accept-side validator reject malformed items.
  "add_rule", "amend_paragraph", "remove_rule",
  "add_pair", "amend_pair", "remove_pair",
  "add_pattern", "amend_pattern", "remove_pattern",
  "add_axis", "amend_axis", "add_decision_rule",
  "add_step", "amend_step", "add_transition",
  "add_template", "amend_template",
  "add_paragraph",
]);

const MIN_PROPOSED_TEXT = 4;
const MAX_PROPOSED_TEXT = 400;
const MAX_RATIONALE = 500;

/**
 * Validate + normalize the raw tool_use input from Sonnet.
 * Pure — exported for tests.
 *
 * @param {unknown} raw — `{propositions: [...]}` from the tool input
 * @returns {Array<{target_kind, proposal}>}
 */
export function normalizeBatchOutput(raw) {
  if (!raw || typeof raw !== "object") return [];
  const items = Array.isArray(raw.propositions) ? raw.propositions : [];
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;

    const target_kind = typeof item.target_kind === "string" ? item.target_kind.trim() : null;
    if (!target_kind || !TARGET_KINDS.has(target_kind)) continue;

    const intent = typeof item.intent === "string" ? item.intent.trim() : null;
    if (!intent || !VALID_INTENTS.has(intent)) continue;

    const proposed_text = typeof item.proposed_text === "string" ? item.proposed_text.trim() : "";
    if (proposed_text.length < MIN_PROPOSED_TEXT) continue;
    if (proposed_text.length > MAX_PROPOSED_TEXT) continue;

    const rationale = typeof item.rationale === "string" ? item.rationale.trim().slice(0, MAX_RATIONALE) : "";

    let confidence = 0.5;
    if (typeof item.confidence === "number" && Number.isFinite(item.confidence)) {
      confidence = Math.max(0, Math.min(1, item.confidence));
      confidence = Number(confidence.toFixed(2));
    }

    out.push({
      target_kind,
      proposal: { intent, target_kind, proposed_text, rationale, confidence },
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/protocol-v2-doc-extractor.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/protocol-v2-doc-extractor.js test/protocol-v2-doc-extractor.test.js
git commit -m "feat(protocol): doc-extractor module shell with normalizeBatchOutput"
```

### Task 2: Tool schema + system prompt

**Files:**
- Modify: `lib/protocol-v2-doc-extractor.js`
- Modify: `test/protocol-v2-doc-extractor.test.js`

- [ ] **Step 1: Write the failing test for `EXTRACTOR_TOOL` schema shape**

Add to `test/protocol-v2-doc-extractor.test.js`:

```javascript
import { EXTRACTOR_TOOL, EXTRACTOR_SYSTEM_PROMPT } from "../lib/protocol-v2-doc-extractor.js";

describe("EXTRACTOR_TOOL", () => {
  it("declares one tool named emit_propositions", () => {
    assert.equal(EXTRACTOR_TOOL.name, "emit_propositions");
    assert.ok(EXTRACTOR_TOOL.description);
    assert.ok(EXTRACTOR_TOOL.input_schema);
  });

  it("input_schema has propositions array of typed objects with enum target_kind", () => {
    const s = EXTRACTOR_TOOL.input_schema;
    assert.equal(s.type, "object");
    assert.ok(s.properties.propositions);
    assert.equal(s.properties.propositions.type, "array");
    const item = s.properties.propositions.items;
    assert.deepEqual(item.required.sort(), ["confidence", "intent", "proposed_text", "target_kind"].sort());
    assert.deepEqual(
      item.properties.target_kind.enum.sort(),
      ["errors", "hard_rules", "icp_patterns", "process", "scoring", "templates"],
    );
  });
});

describe("EXTRACTOR_SYSTEM_PROMPT", () => {
  it("mentions all 6 target kinds", () => {
    for (const kind of ["hard_rules", "errors", "icp_patterns", "scoring", "process", "templates"]) {
      assert.ok(EXTRACTOR_SYSTEM_PROMPT.includes(kind), `missing ${kind} in prompt`);
    }
  });

  it("instructs to emit MULTIPLE items per chunk and not skip prose narrative", () => {
    // Two key bias correctors versus the old Haiku router.
    assert.match(EXTRACTOR_SYSTEM_PROMPT, /(plusieurs|multiple|N items|tous les items)/i);
    assert.match(EXTRACTOR_SYSTEM_PROMPT, /(narrati|prose)/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/protocol-v2-doc-extractor.test.js`
Expected: FAIL — `EXTRACTOR_TOOL is undefined`.

- [ ] **Step 3: Add EXTRACTOR_TOOL + EXTRACTOR_SYSTEM_PROMPT exports**

In `lib/protocol-v2-doc-extractor.js`, add at the top after the constants:

```javascript
export const EXTRACTOR_SYSTEM_PROMPT = `Tu es un extracteur multi-cible pour un protocole opérationnel de clone IA LinkedIn (setter outbound francophone).

À partir d'un fragment de document source (prose française, narratif ou structuré), tu émets TOUTES les propositions d'amendement applicables — réparties sur 6 sections du protocole. Un seul fragment peut produire 0, 1, ou plusieurs propositions, parfois sur plusieurs sections à la fois.

Sections (target_kind) :

- **hard_rules** — règles absolues testables programmatiquement. Ex: "Max 6 lignes par message", "Jamais pitcher l'offre avant que le prospect ait exprimé une douleur", "Toujours signer 'Nicolas'".
- **errors** — paires "éviter X — préférer Y" (formulations spécifiques à remplacer). Ex: "Éviter 'j'espère que tu vas bien' — préférer une accroche ancrée sur le profil".
- **icp_patterns** — taxonomie des profils prospects (segment + signaux d'identification + question-clé pour creuser). Ex: "P1 Founder solo SaaS B2B 1-10 employés / signaux : titre 'Founder' ou 'CEO' + headcount LinkedIn ≤ 10 / question : comment tu structures ta journée entre delivery et acquisition ?".
- **scoring** — axes de score 0-3 avec critères d'évaluation OU règles de décision basées sur un score. Ex: "Axe 1 — Maturité business : 0=idéation, 1=premières ventes, 2=récurrent <10k€/mois, 3=récurrent >10k€/mois". Ou: "Si axe1 ≥ 2 ET axe2 ≥ 1 → proposer le call".
- **process** — étapes du process commercial (DR → M1 → relance → call), avec prérequis, actions, outputs, transitions entre états. Ex: "Étape M1 (icebreaker) : prérequis = DR acceptée. Action = envoyer un message ancré sur le profil. Output = réponse ou relance J+2. Transition vers M2 si réponse, sortie propre si silence J+7".
- **templates** — squelettes de message par scénario (icebreaker, relance, sortie propre, etc.) avec slots ordonnés. Ex: "Skeleton icebreaker DR-reçue : 'merxi pour la connexion {prénom} / je suis curieux de savoir ce qui t'a amené à faire la demande 🙂 / Nicolas'".

CONSIGNES CRITIQUES :

1. **Ne saute pas la prose narrative.** Un paragraphe qui décrit l'identité du founder, l'ICP en mots libres, ou un process en récit, contient des propositions extractibles. Ne renvoie [] que si le fragment est purement organisationnel (titres, sommaire, headers vides) ou hors-scope (technique, RGPD).

2. **Émets PLUSIEURS items quand le fragment couvre plusieurs aspects.** Un fragment décrivant à la fois l'ICP, un axe de scoring et une règle de décision doit produire 3+ propositions, pas 1 résumé global.

3. **Atomicité.** Chaque proposition = UNE règle, UN axe, UN segment ICP, UN template. Pas de sur-fusion ("règle générale qui couvre 5 cas").

4. **Confidence.** 0.9+ = règle/info littéralement dans le doc avec formulation impérative. 0.6-0.8 = paraphrase fidèle d'un passage narratif. 0.3-0.5 = inférence. < 0.5 sera filtré côté serveur — donc si tu hésites, donne 0.5 et laisse passer plutôt qu'inventer < 0.5.

5. **Pas d'invention.** Si le fragment ne contient pas le matériau, n'émets pas.

6. **Intent par section :**
   - hard_rules : add_rule | amend_paragraph | remove_rule
   - errors : add_pair | amend_pair | remove_pair
   - icp_patterns : add_pattern | amend_pattern | remove_pattern
   - scoring : add_axis | amend_axis | add_decision_rule
   - process : add_step | amend_step | add_transition
   - templates : add_template | amend_template
   Tu peux aussi utiliser \`add_paragraph\` comme intent générique si rien d'autre ne colle.

Tu DOIS appeler le tool \`emit_propositions\` avec ta réponse — pas de texte libre.`;

export const EXTRACTOR_TOOL = Object.freeze({
  name: "emit_propositions",
  description: "Émet 0..N propositions d'amendement au protocole, classées par target_kind. Une seule invocation par fragment ; émets tous les items applicables d'un coup.",
  input_schema: {
    type: "object",
    properties: {
      propositions: {
        type: "array",
        description: "Liste des propositions extraites. Vide si rien d'extractible.",
        items: {
          type: "object",
          required: ["target_kind", "intent", "proposed_text", "confidence"],
          properties: {
            target_kind: {
              type: "string",
              enum: ["hard_rules", "errors", "icp_patterns", "scoring", "process", "templates"],
              description: "Section cible du protocole.",
            },
            intent: {
              type: "string",
              description: "Verbe d'action — voir consignes pour le vocabulaire par section.",
            },
            proposed_text: {
              type: "string",
              description: "Formulation canonique française, ≤ 400 chars, prête à devenir prose ou rule_text.",
            },
            rationale: {
              type: "string",
              description: "Pourquoi cette proposition, ancrée au fragment source. ≤ 500 chars.",
            },
            confidence: {
              type: "number",
              description: "0.0 à 1.0. Voir consignes pour la calibration.",
            },
          },
        },
      },
    },
    required: ["propositions"],
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/protocol-v2-doc-extractor.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/protocol-v2-doc-extractor.js test/protocol-v2-doc-extractor.test.js
git commit -m "feat(protocol): EXTRACTOR_TOOL schema + system prompt for doc-import"
```

### Task 3: `extractFromChunk` — the actual Anthropic call

**Files:**
- Modify: `lib/protocol-v2-doc-extractor.js`
- Modify: `test/protocol-v2-doc-extractor.test.js`

- [ ] **Step 1: Write the failing test for `extractFromChunk` with mocked Anthropic**

Add to `test/protocol-v2-doc-extractor.test.js`:

```javascript
import { extractFromChunk } from "../lib/protocol-v2-doc-extractor.js";

function makeAnthropicStub({ toolInput, contentOverride } = {}) {
  return {
    messages: {
      create: async (params) => {
        // Capture for assertions.
        makeAnthropicStub.lastCall = params;
        if (contentOverride) return contentOverride;
        return {
          content: [
            {
              type: "tool_use",
              name: "emit_propositions",
              input: toolInput || { propositions: [] },
            },
          ],
        };
      },
    },
  };
}

describe("extractFromChunk", () => {
  it("returns [] for empty/short chunk without API call", async () => {
    const out = await extractFromChunk("", {}, { anthropic: { messages: { create: () => { throw new Error("should not be called"); } } } });
    assert.deepEqual(out, []);
  });

  it("returns [] when no API key and no anthropic stub provided", async () => {
    const oldKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const out = await extractFromChunk("a real chunk of prose with enough length to pass the min", {}, {});
      assert.deepEqual(out, []);
    } finally {
      if (oldKey) process.env.ANTHROPIC_API_KEY = oldKey;
    }
  });

  it("forwards tool_use input through normalizeBatchOutput", async () => {
    const anthropic = makeAnthropicStub({
      toolInput: {
        propositions: [
          { target_kind: "hard_rules", intent: "add_rule", proposed_text: "Max 6 lignes par message.", confidence: 0.92, rationale: "explicit dans la prose" },
          { target_kind: "icp_patterns", intent: "add_pattern", proposed_text: "Founder solo SaaS B2B 1-10 employés", confidence: 0.85 },
          { target_kind: "garbage", intent: "x", proposed_text: "y", confidence: 0.5 }, // dropped by normalize
        ],
      },
    });
    const out = await extractFromChunk("Max 6 lignes par message dans tout DM. Cible : founders solo SaaS.", { doc_filename: "doc.md", doc_kind: "operational_playbook" }, { anthropic });
    assert.equal(out.length, 2);
    assert.equal(out[0].target_kind, "hard_rules");
    assert.equal(out[1].target_kind, "icp_patterns");
  });

  it("forces tool_choice on emit_propositions and includes context in user message", async () => {
    const anthropic = makeAnthropicStub({ toolInput: { propositions: [] } });
    await extractFromChunk("some chunk text", { doc_filename: "process.md", doc_kind: "operational_playbook" }, { anthropic });
    const params = makeAnthropicStub.lastCall;
    assert.equal(params.tool_choice.type, "tool");
    assert.equal(params.tool_choice.name, "emit_propositions");
    assert.equal(params.tools.length, 1);
    assert.equal(params.tools[0].name, "emit_propositions");
    // user message mentions the filename
    const userText = params.messages[0].content;
    assert.match(userText, /process\.md/);
    assert.match(userText, /operational_playbook/);
    assert.match(userText, /some chunk text/);
  });

  it("returns [] on timeout or thrown error", async () => {
    const throwing = { messages: { create: async () => { throw new Error("net fail"); } } };
    const out = await extractFromChunk("a real chunk of prose with enough length", {}, { anthropic: throwing });
    assert.deepEqual(out, []);
  });

  it("returns [] when no tool_use block in response", async () => {
    const noTool = makeAnthropicStub({ contentOverride: { content: [{ type: "text", text: "I refuse" }] } });
    const out = await extractFromChunk("a real chunk of prose with enough length", {}, { anthropic: noTool });
    assert.deepEqual(out, []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/protocol-v2-doc-extractor.test.js`
Expected: FAIL — `extractFromChunk is undefined`.

- [ ] **Step 3: Implement `extractFromChunk`**

Add to `lib/protocol-v2-doc-extractor.js`:

```javascript
import Anthropic from "@anthropic-ai/sdk";
import { log } from "./log.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 30000;
const MIN_CHUNK_LEN = 40;
const MAX_CHUNK_LEN = 4000;

function buildUserMessage(chunk, ctx) {
  const lines = [];
  const c = ctx && typeof ctx === "object" ? ctx : {};
  if (typeof c.doc_filename === "string" && c.doc_filename) {
    lines.push(`Fichier source : ${c.doc_filename}`);
  }
  if (typeof c.doc_kind === "string" && c.doc_kind) {
    lines.push(`Type de doc : ${c.doc_kind}`);
  }
  lines.push(`\nFragment du document :\n"""\n${chunk}\n"""`);
  lines.push(`\nAppelle le tool emit_propositions avec TOUTES les propositions extractibles de ce fragment.`);
  return lines.join("\n");
}

function findToolUse(result) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  for (const b of blocks) {
    if (b?.type === "tool_use" && b.name === "emit_propositions") {
      return b.input;
    }
  }
  return null;
}

/**
 * Single Sonnet call that emits 0..N propositions across all 6 target_kinds.
 *
 * @param {string} chunk
 * @param {{doc_filename?:string, doc_kind?:string}} ctx
 * @param {object} [opts]
 * @param {object} [opts.anthropic]   — injectable client (for tests)
 * @param {string} [opts.apiKey]
 * @param {string} [opts.model]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<Array<{target_kind, proposal}>>}
 */
export async function extractFromChunk(chunk, ctx = {}, opts = {}) {
  if (typeof chunk !== "string") return [];
  const trimmed = chunk.trim();
  if (trimmed.length < MIN_CHUNK_LEN) return [];
  if (trimmed.length > MAX_CHUNK_LEN) return [];

  const model = opts.model || DEFAULT_MODEL;
  const maxTokens = opts.maxTokens || DEFAULT_MAX_TOKENS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let anthropic = opts.anthropic;
  if (!anthropic) {
    const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return [];
    anthropic = new Anthropic({ apiKey });
  }

  const userMsg = buildUserMessage(trimmed, ctx);

  try {
    const result = await Promise.race([
      anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        system: EXTRACTOR_SYSTEM_PROMPT,
        tools: [EXTRACTOR_TOOL],
        tool_choice: { type: "tool", name: EXTRACTOR_TOOL.name },
        messages: [{ role: "user", content: userMsg }],
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("doc_extractor_timeout")), timeoutMs)),
    ]);

    const toolInput = findToolUse(result);
    if (!toolInput) return [];

    return normalizeBatchOutput(toolInput);
  } catch (err) {
    log("protocol_v2_doc_extractor_error", { message: err?.message || String(err) });
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/protocol-v2-doc-extractor.test.js`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/protocol-v2-doc-extractor.js test/protocol-v2-doc-extractor.test.js
git commit -m "feat(protocol): extractFromChunk — single Sonnet tool_use call per chunk"
```

---

## Chunk 2: Wire into import-doc.js

### Task 4: Inject `extractFromChunk` as a deps-overridable handler

**Files:**
- Modify: `api/v2/protocol/import-doc.js:54-65` (imports), `api/v2/protocol/import-doc.js:190-202` (deps), `api/v2/protocol/import-doc.js:296-314` (null branch)
- Modify: `test/api-v2-protocol-import-doc.test.js`

- [ ] **Step 1: Write the failing test asserting the new path uses `extractFromChunk` instead of `routeAndExtract`**

Add to `test/api-v2-protocol-import-doc.test.js` (a new `describe` block):

```javascript
import { extractFromChunk as _extractFromChunk } from "../lib/protocol-v2-doc-extractor.js";

describe("operational_playbook routes through extractFromChunk", () => {
  it("calls extractFromChunk once per chunk and not routeAndExtract", async () => {
    const sb = makeSupabase();
    const calls = { extract: 0, routeAndExtract: 0 };
    const stubExtract = async () => {
      calls.extract++;
      return [
        {
          target_kind: "hard_rules",
          proposal: { target_kind: "hard_rules", intent: "add_rule", proposed_text: "Max 6 lignes par message.", rationale: "doc explicit", confidence: 0.9 },
        },
      ];
    };
    const stubRouteAndExtract = async () => {
      calls.routeAndExtract++;
      return [];
    };

    const docText = ("Lorem ipsum dolor sit amet consectetur adipiscing elit. ".repeat(30) + "\n\n").repeat(3);

    const res = makeRes();
    await handler(
      { method: "POST", body: { persona_id: VALID_PERSONA, doc_text: docText, doc_filename: "x.md", doc_kind: "operational_playbook" } },
      res,
      {
        authenticateRequest: async () => ({ client: { id: "u1" }, isAdmin: true }),
        hasPersonaAccess: async () => true,
        supabase: sb,
        setCors: () => {},
        routeAndExtract: stubRouteAndExtract,
        extractFromChunk: stubExtract,
        embedForProposition: async () => null,
        findSimilarProposition: async () => [],
      },
    );

    assert.equal(res.statusCode, 200);
    assert.ok(calls.extract >= 1, "extractFromChunk should have been called");
    assert.equal(calls.routeAndExtract, 0, "routeAndExtract must NOT be called for operational_playbook");
    assert.ok(res.body.candidates_total >= 1);
  });

  it("explicit-extractTargets path (icp_audience) still uses runExtractors, NOT extractFromChunk", async () => {
    const sb = makeSupabase();
    const calls = { extract: 0, runExtractors: 0 };
    const stubExtract = async () => { calls.extract++; return []; };
    const stubRunExtractors = async () => { calls.runExtractors++; return []; };

    const docText = ("Lorem ipsum dolor sit amet consectetur. ".repeat(30) + "\n\n").repeat(2);

    const res = makeRes();
    await handler(
      { method: "POST", body: { persona_id: VALID_PERSONA, doc_text: docText, doc_kind: "icp_audience" } },
      res,
      {
        authenticateRequest: async () => ({ client: { id: "u1" }, isAdmin: true }),
        hasPersonaAccess: async () => true,
        supabase: sb,
        setCors: () => {},
        runExtractors: stubRunExtractors,
        extractFromChunk: stubExtract,
        embedForProposition: async () => null,
        findSimilarProposition: async () => [],
      },
    );

    assert.equal(res.statusCode, 200);
    assert.ok(calls.runExtractors >= 1);
    assert.equal(calls.extract, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/api-v2-protocol-import-doc.test.js`
Expected: FAIL — the operational_playbook path still goes through `routeAndExtract`.

- [ ] **Step 3: Modify `api/v2/protocol/import-doc.js`**

At the top (line ~54-64), add the new import:

```javascript
import { extractFromChunk as _extractFromChunk } from "../../../lib/protocol-v2-doc-extractor.js";
```

In the handler's deps destructure (line ~190-202), add:

```javascript
    extractFromChunk = _extractFromChunk,
```

Replace the entire `null` branch in the extraction phase (line ~297-314):

```javascript
  if (routing.extractTargets === null) {
    const settled = await Promise.allSettled(
      chunks.map((chunk) =>
        extractFromChunk(chunk, ctx, {}),
      ),
    );
    for (const s of settled) {
      if (s.status === "fulfilled" && Array.isArray(s.value)) {
        allCandidates.push(...s.value);
      } else if (s.status === "rejected") {
        log("protocol_v2_import_doc_chunk_error", {
          message: s.reason?.message || String(s.reason),
        });
      }
    }
  } else if (routing.extractTargets.length > 0) {
```

(Leave the `else if (routing.extractTargets.length > 0)` branch unchanged — `runExtractors` still drives explicit doc_kinds.)

Also update the file's top doc comment block (lines 19-34) to reflect the new flow:

```
// Flow :
//   1. Auth + persona access. Resolve persona → active GLOBAL protocol_document
//      (source_core IS NULL).
//   2. Chunk the doc into ≤3 500-char prose blocks (paragraph-aware, sentence
//      fallback for very long paragraphs).
//   3. Routing per doc_kind (KIND_ROUTING) :
//        - extractTargets === null   → for each chunk, ONE Sonnet tool_use
//          call (extractFromChunk) emits 0..N propositions tagged by
//          target_kind. No router gate, no per-target Sonnet fan-out.
//        - extractTargets === []     → no extraction (identity-only, e.g.
//          persona_context).
//        - extractTargets === [kinds] → for each chunk, runExtractors with
//          the explicit kinds (PR #215 flow, unchanged).
//   4. For each extracted candidate :
//        - Embed `proposed_text` (Voyage 1024 dims).
//        - findSimilarProposition against pending propositions of this doc
//          (same target_kind, threshold 0.85).
//        - Match → MERGE: append batch_id to source_refs, count++.
//        - No match + confidence ≥ 0.5 → INSERT pending proposition.
//        - Otherwise → silenced (low confidence singleton).
//   5. Persist batch row + return summary.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/api-v2-protocol-import-doc.test.js`
Expected: PASS (existing tests still green + 2 new tests).

- [ ] **Step 5: Run the full test suite to verify nothing else broke**

Run: `npm test`
Expected: All tests pass. If any router-related test breaks (unlikely, since `routeAndExtract` is untouched), inspect and fix.

- [ ] **Step 6: Commit**

```bash
git add api/v2/protocol/import-doc.js test/api-v2-protocol-import-doc.test.js
git commit -m "feat(protocol): wire extractFromChunk into import-doc operational_playbook path"
```

---

## Chunk 3: Real-world validation + cleanup

### Task 5: Validate on Nicolas's process-setter.md fixture

**Files:**
- Modify: `scripts/test-import-nicolas-process.js` (already exists from prior session)

- [ ] **Step 1: Run the existing test-import script in dry-run mode to capture baseline counts**

Run: `node scripts/test-import-nicolas-process.js --dry-run`
Expected: this hits the new `extractFromChunk` path (since `process-setter.md` is sent without doc_kind, defaulting to `generic` → null extractTargets). Capture the output: `chunks_processed`, `candidates_total`, `propositions_created`.

Compare against the pre-PR baseline from the prior session: 4 chunks → 1-2 candidates → 1-2 propositions. Expected new behavior: 4 chunks → 12-24 candidates → 8-15 propositions after dedup.

- [ ] **Step 2: If candidates_total < 6, debug**

Possible failure modes:
- Sonnet emits empty `propositions: []` for narrative chunks → tighten the system prompt's "do not skip narrative" instruction
- `tool_choice` not enforced → re-check the API call
- Schema mismatch causes normalize to drop everything → log raw `toolInput` before normalize

If debugging needed, temporarily add `console.log("raw toolInput:", JSON.stringify(toolInput, null, 2))` before the `normalizeBatchOutput` call and re-run. Remove the log before commit.

- [ ] **Step 3: Run for real (writes to DB) on Nicolas's persona**

Run: `node scripts/test-import-nicolas-process.js`
Expected: 8-15 propositions inserted, distributed across `hard_rules`, `errors`, `icp_patterns`, `scoring`, `process`, `templates`. Capture the breakdown table.

If the count is acceptable (≥ 6, distributed across ≥ 3 sections), proceed. Otherwise iterate on the system prompt and re-test.

- [ ] **Step 4: Commit any prompt iterations**

```bash
git add lib/protocol-v2-doc-extractor.js
git commit -m "fix(protocol): tighten doc-extractor system prompt for prose recall"
```

(Skip this step if no iteration was needed.)

### Task 6: Clean up obsolete code paths

**Files:**
- Modify: `lib/protocol-v2-extractor-router.js` — only if `routeAndExtract` no longer has callers

- [ ] **Step 1: Audit remaining callers of `routeAndExtract`**

Run: `grep -rn "routeAndExtract\|routeSignal" --include="*.js" lib/ api/ scripts/ | grep -v test/ | grep -v -- "-doc-extractor.js"`
Expected: at least one caller in `api/cron/protocol-v2-drain.js` (or wherever feedback events are consolidated). If yes, `routeAndExtract` STAYS — DO NOT delete.

- [ ] **Step 2: Document the split in `lib/protocol-v2-extractor-router.js` header**

Prepend to the file's top comment:

```
// CALLERS (as of PR #220) :
//   - api/cron/protocol-v2-drain.js — feedback_event consolidation cron
//   - api/v2/protocol/import-doc.js — explicit extractTargets path only
//     (icp_audience, positioning). The null path uses
//     lib/protocol-v2-doc-extractor.js (single Sonnet tool_use call).
```

- [ ] **Step 3: Commit**

```bash
git add lib/protocol-v2-extractor-router.js
git commit -m "docs(protocol): document extractor-router callers post-doc-extractor split"
```

### Task 7: PR

- [ ] **Step 1: Push branch + open PR**

```bash
git push -u origin claude/dreamy-villani-ce0ac2
gh pr create --title "feat(protocol): single-call doc extractor for operational_playbook (recall fix)" --body "$(cat <<'EOF'
## Summary

Replace Haiku-router + per-target-Sonnet pipeline (used only on the `operational_playbook` / `generic` doc-import path) with a single Sonnet tool_use call per chunk that emits an array of typed propositions discriminated by target_kind.

**Problem (measured 2026-05-02):** Haiku router gates prose chunks and returns `[]` for 3 of 4 chunks on Nicolas's process-setter.md (12k chars), producing 1-2 propositions on a doc that should yield 30+.

**Fix:** Eliminate the chunk-level router gate. Sonnet self-routes per item via the discriminated Union `target_kind` field. No new dependency — uses the `@anthropic-ai/sdk` already in the stack.

## Scope

- Adds `lib/protocol-v2-doc-extractor.js` — the new single-call extractor
- Wires it into `api/v2/protocol/import-doc.js` for the `null` extractTargets path only
- The 6 individual extractors and `routeAndExtract` STAY UNCHANGED (still used by feedback-event consolidation and explicit-targets paths from PR #215)

## Validation

Before/after on `test/fixtures/process-setter.md` :
- before: 4 chunks → 1-2 candidates → 1-2 propositions
- after:  4 chunks → [TBD] candidates → [TBD] propositions distributed across [TBD] sections

(Numbers from `node scripts/test-import-nicolas-process.js`.)

## Test plan

- [ ] `node --test test/protocol-v2-doc-extractor.test.js` (13 unit tests)
- [ ] `node --test test/api-v2-protocol-import-doc.test.js` (handler integration, including the new operational_playbook → extractFromChunk assertion)
- [ ] Manual: import process-setter.md via UI on preview, verify Calibration view (PR #216) shows the new batch with N propositions

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Verify CI green**

Wait for CI to finish on the PR. If anything fails, debug locally and push fixes.

- [ ] **Step 3: Hand off to user**

Report PR URL + the before/after candidates/propositions counts from Task 5 to the user. They decide whether to merge.

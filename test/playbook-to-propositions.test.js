import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractPlaybookToPropositions,
  splitForExtractor,
} from "../lib/playbook-to-propositions.js";

const PROSE_3_TOGGLES = `
## 1. ICEBREAKER

${"a".repeat(120)} curiosité symétrique sur le profil visité ${"b".repeat(120)}

## 2. QUALIFIER LA RÉPONSE + SWOT / TOWS

${"c".repeat(120)} qualification persona infopreneur ${"d".repeat(120)}

## 3. CREUSEMENT

${"e".repeat(120)} question miroir ancrée dans le WT ${"f".repeat(120)}
`;

test("extractPlaybookToPropositions — appelle extractFromChunk pour chaque toggle valide", async () => {
  const calls = [];
  const fakeExtract = async (chunk, ctx) => {
    calls.push({ len: chunk.length, ctx });
    return [
      {
        target_kind: "hard_rules",
        proposal: {
          intent: "add_rule",
          target_kind: "hard_rules",
          proposed_text: `règle extraite du chunk ${calls.length}`,
          rationale: "test",
          confidence: 0.8,
        },
      },
    ];
  };

  const result = await extractPlaybookToPropositions(
    {
      prose: PROSE_3_TOGGLES,
      sourceCore: "visite_profil",
      playbookId: "11111111-1111-1111-1111-111111111111",
    },
    { extractFromChunk: fakeExtract }
  );

  assert.equal(calls.length, 3, "3 toggles → 3 appels extractFromChunk");
  assert.equal(result.length, 3, "3 candidats produits");
  assert.equal(result[0].provenance.source_core, "visite_profil");
  assert.equal(result[0].provenance.toggle_idx, 1);
  assert.match(result[0].provenance.toggle_title, /ICEBREAKER/);
  assert.equal(result[0].provenance.playbook_id, "11111111-1111-1111-1111-111111111111");
  assert.equal(result[1].provenance.toggle_idx, 2);
  assert.equal(result[2].provenance.toggle_idx, 3);
});

test("extractPlaybookToPropositions — skip toggles trop courts (<40 chars)", async () => {
  const proseShortToggle = `
## 1. ICEBREAKER

short

## 2. QUALIF

${"x".repeat(200)} prose suffisamment longue ${"y".repeat(200)}
`;
  const skips = [];
  const fakeExtract = async () => [
    { target_kind: "process", proposal: { intent: "add_paragraph", target_kind: "process", proposed_text: "ok", rationale: "", confidence: 0.7 } },
  ];

  const result = await extractPlaybookToPropositions(
    {
      prose: proseShortToggle,
      sourceCore: "dr_recue",
      playbookId: "22222222-2222-2222-2222-222222222222",
    },
    { extractFromChunk: fakeExtract, onSkip: (s) => skips.push(s) }
  );

  assert.equal(result.length, 1, "seulement T2 traité");
  assert.equal(skips.length, 1);
  assert.equal(skips[0].toggle_idx, 1);
  assert.equal(skips[0].reason, "toggle_too_short");
});

test("extractPlaybookToPropositions — chunke les toggles trop longs (>4000 chars)", async () => {
  const longToggle = `
## 1. ICEBREAKER

${"paragraphe long.\n\n".repeat(300)}
`;
  // 300 × 18 chars ≈ 5400 chars → doit être split
  const calls = [];
  const fakeExtract = async (chunk) => {
    calls.push(chunk.length);
    return [
      { target_kind: "templates", proposal: { intent: "add_paragraph", target_kind: "templates", proposed_text: `chunk ${calls.length}`, rationale: "", confidence: 0.6 } },
    ];
  };

  const result = await extractPlaybookToPropositions(
    {
      prose: longToggle,
      sourceCore: "spyer",
      playbookId: "33333333-3333-3333-3333-333333333333",
    },
    { extractFromChunk: fakeExtract }
  );

  assert.ok(calls.length >= 2, "splittage en sous-chunks");
  for (const len of calls) {
    assert.ok(len <= 4000, `sous-chunk ${len} ≤ 4000`);
  }
  // Tous les sous-chunks gardent l'attribution toggle_idx=1
  for (const r of result) {
    assert.equal(r.provenance.toggle_idx, 1);
  }
});

test("extractPlaybookToPropositions — args invalides", async () => {
  await assert.rejects(
    () => extractPlaybookToPropositions({ prose: "x", playbookId: "p" }, {}),
    /sourceCore is required/
  );
  await assert.rejects(
    () => extractPlaybookToPropositions({ prose: "x", sourceCore: "visite_profil" }, {}),
    /playbookId is required/
  );
  // Prose vide → array vide, pas d'erreur
  const r = await extractPlaybookToPropositions(
    { prose: "", sourceCore: "visite_profil", playbookId: "p" },
    {}
  );
  assert.deepEqual(r, []);
});

test("splitForExtractor — split sur double newline", () => {
  const text = "para1\n\n" + "x".repeat(3000) + "\n\n" + "y".repeat(3000) + "\n\nfin";
  const parts = splitForExtractor(text);
  assert.ok(parts.length >= 2);
  for (const p of parts) {
    assert.ok(p.length <= 4000);
    assert.ok(p.length >= 40);
  }
});

test("splitForExtractor — input court retourné tel quel", () => {
  const short = "petite prose";
  assert.deepEqual(splitForExtractor(short), [short]);
});

// ── PR #232 — surface per-toggle empty vs error ──────────────────
//
// Bug context: visite_profil playbook (14k chars, 6 toggles) extracted 0
// propositions in prod while sibling playbooks succeeded. The catch in
// extractFromChunk swallowed errors and returned []; callers couldn't
// distinguish "LLM legitimately returned []" from "call failed silently".
//
// Fix: extractor now exposes opts.onError; playbook helper fires onSkip with
// reason='extractor_returned_empty' for empty case and onError for failures.

test("extractPlaybookToPropositions — onSkip fires with reason='extractor_returned_empty' when LLM returns []", async () => {
  const skips = [];
  const errors = [];
  const fakeExtract = async () => []; // legitimate empty

  const result = await extractPlaybookToPropositions(
    {
      prose: PROSE_3_TOGGLES,
      sourceCore: "visite_profil",
      playbookId: "11111111-1111-1111-1111-111111111111",
    },
    {
      extractFromChunk: fakeExtract,
      onSkip: (s) => skips.push(s),
      onError: (e) => errors.push(e),
    }
  );

  assert.equal(result.length, 0);
  assert.equal(errors.length, 0, "no error fired for legitimate empty");
  assert.equal(skips.length, 3, "3 toggles all empty → 3 skip events");
  for (const s of skips) {
    assert.equal(s.reason, "extractor_returned_empty");
    assert.ok(typeof s.toggle_idx === "number");
    assert.ok(typeof s.toggle_title === "string");
  }
});

test("extractPlaybookToPropositions — onError fires when extractor invokes its onError callback", async () => {
  const skips = [];
  const errors = [];
  // Simulate the real extractor: catches internally, calls onError, returns [].
  const fakeExtract = async (_chunk, _ctx, opts) => {
    if (typeof opts?.onError === "function") {
      opts.onError({ message: "doc_extractor_timeout", retryable: true, chunk_len: 500 });
    }
    return [];
  };

  const result = await extractPlaybookToPropositions(
    {
      prose: PROSE_3_TOGGLES,
      sourceCore: "visite_profil",
      playbookId: "11111111-1111-1111-1111-111111111111",
    },
    {
      extractFromChunk: fakeExtract,
      onSkip: (s) => skips.push(s),
      onError: (e) => errors.push(e),
    }
  );

  assert.equal(result.length, 0);
  assert.equal(errors.length, 3, "3 toggles each errored → 3 error events");
  for (const e of errors) {
    assert.equal(e.message, "doc_extractor_timeout");
    assert.equal(e.retryable, true);
    assert.ok(typeof e.toggle_idx === "number");
    assert.ok(typeof e.toggle_title === "string");
  }
  // Crucial: errored toggles do NOT also fire onSkip(extractor_returned_empty)
  const emptySkips = skips.filter((s) => s.reason === "extractor_returned_empty");
  assert.equal(emptySkips.length, 0, "errored toggles must not be conflated with empty ones");
});

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  deriveCheckParamsHeuristic,
  deriveCheckParams,
  normalizeLlmOutput,
} from "../lib/protocol-v2-check-derivation.js";

describe("deriveCheckParamsHeuristic", () => {
  it("counter/lines : 'Max 8 lignes au total'", () => {
    const out = deriveCheckParamsHeuristic("Max 8 lignes au total dans un DM");
    assert.deepEqual(out, {
      check_kind: "counter",
      check_params: { what: "lines", max: 8 },
    });
  });

  it("counter/lines : 'Pas plus de 12 lignes'", () => {
    const out = deriveCheckParamsHeuristic("Pas plus de 12 lignes par message");
    assert.deepEqual(out, {
      check_kind: "counter",
      check_params: { what: "lines", max: 12 },
    });
  });

  it("counter/questions : 'Jamais plus de deux questions par message' → max=2", () => {
    const out = deriveCheckParamsHeuristic("Jamais plus de deux questions par message");
    // "jamais plus de deux" = max 2 allowed (strictly more than 2 forbidden).
    assert.deepEqual(out, {
      check_kind: "counter",
      check_params: { what: "questions", max: 2 },
    });
  });

  it("counter/questions : 'Jamais deux questions dans le même message' → max=1", () => {
    const out = deriveCheckParamsHeuristic("Jamais deux questions dans le même message");
    // "jamais deux" = strictly less than 2 = max 1.
    assert.deepEqual(out, {
      check_kind: "counter",
      check_params: { what: "questions", max: 1 },
    });
  });

  it("counter/questions : 'Max 2 questions'", () => {
    const out = deriveCheckParamsHeuristic("Max 2 questions par message");
    assert.deepEqual(out, {
      check_kind: "counter",
      check_params: { what: "questions", max: 2 },
    });
  });

  it("counter/questions : 'Une seule question par message'", () => {
    const out = deriveCheckParamsHeuristic("Une seule question par message, jamais deux");
    assert.deepEqual(out, {
      check_kind: "counter",
      check_params: { what: "questions", max: 1 },
    });
  });

  it("max_length : 'Max 500 caractères'", () => {
    const out = deriveCheckParamsHeuristic("Max 500 caractères dans un DM");
    assert.deepEqual(out, {
      check_kind: "max_length",
      check_params: { chars: 500 },
    });
  });

  it("structural : 'Jamais de liste à puces'", () => {
    const out = deriveCheckParamsHeuristic("Jamais de liste à puces dans un message");
    assert.deepEqual(out, {
      check_kind: "structural",
      check_params: { deny: "markdown_list" },
    });
  });

  it("structural : 'Pas de signature complète'", () => {
    const out = deriveCheckParamsHeuristic("Pas de signature complète, juste prénom");
    assert.deepEqual(out, {
      check_kind: "structural",
      check_params: { deny: "signature_complete" },
    });
  });

  it("structural : 'Jamais de mention de l'offre, du prix, ou du mot accompagnement'", () => {
    const out = deriveCheckParamsHeuristic("Jamais de mention de l'offre, du prix, ou du mot accompagnement");
    assert.deepEqual(out, {
      check_kind: "structural",
      check_params: { deny: "offer_mention" },
    });
  });

  it('regex : \'Ne jamais commencer par "J\'espère que tu vas bien"\'', () => {
    // Use double quotes around the phrase so the embedded apostrophe in
    // "J'espère" doesn't close the capture too early. This is the
    // realistic shape — the rule writer uses « ... » or "..." when the
    // phrase contains an apostrophe.
    const out = deriveCheckParamsHeuristic('Ne jamais commencer par "J\'espère que tu vas bien"');
    assert.equal(out.check_kind, "regex");
    assert.equal(out.check_params.flags, "i");
    assert.equal(out.check_params.max_matches, 0);
    assert.match(out.check_params.pattern, /J.espère que tu vas bien/);
  });

  it("regex : guillemets français autour de la phrase", () => {
    const out = deriveCheckParamsHeuristic("Ne jamais commencer par « Salut prénom »");
    assert(out, "should match guillemets");
    assert.equal(out.check_kind, "regex");
    assert.match(out.check_params.pattern, /Salut prénom/);
  });

  it("returns null for non-matching prose (LLM fallback territory)", () => {
    const out = deriveCheckParamsHeuristic("Sois chaleureux et naturel dans ta formulation");
    assert.equal(out, null);
  });

  it("returns null for empty / non-string", () => {
    assert.equal(deriveCheckParamsHeuristic(""), null);
    assert.equal(deriveCheckParamsHeuristic(null), null);
    assert.equal(deriveCheckParamsHeuristic(undefined), null);
  });
});

describe("normalizeLlmOutput", () => {
  it("accepts a valid counter shape", () => {
    const out = normalizeLlmOutput({ check_kind: "counter", check_params: { what: "lines", max: 8 } });
    assert.deepEqual(out, { check_kind: "counter", check_params: { what: "lines", max: 8 } });
  });

  it("rejects a counter with an unknown 'what'", () => {
    const out = normalizeLlmOutput({ check_kind: "counter", check_params: { what: "paragraphs", max: 3 } });
    assert.equal(out, null);
  });

  it("rejects counter with negative max", () => {
    const out = normalizeLlmOutput({ check_kind: "counter", check_params: { what: "lines", max: -1 } });
    assert.equal(out, null);
  });

  it("rejects regex with bad pattern (won't compile)", () => {
    const out = normalizeLlmOutput({
      check_kind: "regex",
      check_params: { pattern: "(?<\nbroken", max_matches: 0 },
    });
    assert.equal(out, null);
  });

  it("rejects unknown check_kind", () => {
    const out = normalizeLlmOutput({ check_kind: "vibes", check_params: {} });
    assert.equal(out, null);
  });

  it("returns null on extractable:false", () => {
    const out = normalizeLlmOutput({ extractable: false, reason: "tonality, not testable" });
    assert.equal(out, null);
  });
});

describe("deriveCheckParams (orchestration)", () => {
  it("returns heuristic match without calling LLM", async () => {
    let called = false;
    const out = await deriveCheckParams("Max 8 lignes au total", {
      anthropic: {
        messages: { create: async () => { called = true; return { content: [{ type: "text", text: "{}" }] }; } },
      },
    });
    assert.deepEqual(out, { check_kind: "counter", check_params: { what: "lines", max: 8 } });
    assert.equal(called, false, "LLM must not be called when heuristic matches");
  });

  it("falls back to LLM when heuristic returns null", async () => {
    const out = await deriveCheckParams("Sois sobre dans le ton, pas de superlatifs", {
      anthropic: {
        messages: {
          create: async () => ({
            content: [{ type: "text", text: '{"check_kind":"regex","check_params":{"pattern":"(super|incroyable|génial)","flags":"i","max_matches":0}}' }],
          }),
        },
      },
    });
    assert.equal(out.check_kind, "regex");
    assert.equal(out.check_params.max_matches, 0);
  });

  it("returns null when LLM says extractable:false", async () => {
    const out = await deriveCheckParams("Adapte ton ton à l'interlocuteur", {
      anthropic: {
        messages: {
          create: async () => ({
            content: [{ type: "text", text: '{"extractable":false,"reason":"too vague"}' }],
          }),
        },
      },
    });
    assert.equal(out, null);
  });

  it("skipLlm option : never calls LLM, returns null when heuristic doesn't match", async () => {
    let called = false;
    const out = await deriveCheckParams("Sois chaleureux", {
      skipLlm: true,
      anthropic: {
        messages: { create: async () => { called = true; return {}; } },
      },
    });
    assert.equal(out, null);
    assert.equal(called, false);
  });

  it("graceful null on LLM exception (timeout etc.)", async () => {
    const out = await deriveCheckParams("Sois sobre dans le ton", {
      anthropic: {
        messages: {
          create: async () => { throw new Error("network down"); },
        },
      },
    });
    assert.equal(out, null);
  });
});

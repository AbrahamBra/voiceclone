import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  extractProcess,
  normalizeProposal,
} from "../lib/protocol-v2-extractors/process.js";

function makeClient(queue) {
  const responses = Array.isArray(queue) ? [...queue] : [queue];
  const client = { calls: 0 };
  client.messages = {
    create: async () => {
      client.calls++;
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (typeof next !== "string") throw new Error("stub_exhausted");
      return { content: [{ type: "text", text: next }] };
    },
  };
  return client;
}

describe("normalizeProposal (process)", () => {
  it("accepts a well-formed add_paragraph step", () => {
    const out = normalizeProposal({
      intent: "add_paragraph",
      proposed_text:
        "Étape 'qualification' — prérequis: première réponse ; actions: 2 questions max ; output: lead scoré 0-3.",
      rationale: "User a décrit l'ordre du process commercial.",
      confidence: 0.9,
    });
    assert.equal(out?.target_kind, "process");
    assert.equal(out?.intent, "add_paragraph");
    assert.equal(out?.confidence, 0.9);
  });

  it("accepts amend_paragraph", () => {
    const out = normalizeProposal({
      intent: "amend_paragraph",
      proposed_text: "Étape 'pitch' — prérequis ajouté: pain point confirmé.",
      confidence: 0.7,
    });
    assert.equal(out?.intent, "amend_paragraph");
  });

  it("returns null when extractable:false", () => {
    assert.equal(
      normalizeProposal({ extractable: false, reason: "validation" }),
      null,
    );
  });

  it("rejects intent specific to other extractors", () => {
    assert.equal(
      normalizeProposal({
        intent: "add_rule",
        proposed_text: "Étape 'X' — prérequis: ...",
        confidence: 0.9,
      }),
      null,
    );
    assert.equal(
      normalizeProposal({
        intent: "refine_pattern",
        proposed_text: "Étape 'X' — ...",
        confidence: 0.8,
      }),
      null,
    );
  });

  it("returns null when proposed_text is missing or too short", () => {
    assert.equal(normalizeProposal({ intent: "add_paragraph" }), null);
    assert.equal(
      normalizeProposal({ intent: "add_paragraph", proposed_text: "abc" }),
      null,
    );
  });

  it("returns null when proposed_text is absurdly long", () => {
    const long = "x".repeat(900);
    assert.equal(
      normalizeProposal({
        intent: "add_paragraph",
        proposed_text: long,
        confidence: 0.9,
      }),
      null,
    );
  });

  it("clamps confidence to [0,1] and rounds to 2 decimals", () => {
    const base = {
      intent: "add_paragraph",
      proposed_text: "Étape 'X' — prérequis: y ; actions: z ; output: w.",
    };
    assert.equal(normalizeProposal({ ...base, confidence: 1.7 })?.confidence, 1);
    assert.equal(normalizeProposal({ ...base, confidence: -0.4 })?.confidence, 0);
    assert.equal(
      normalizeProposal({ ...base, confidence: 0.876543 })?.confidence,
      0.88,
    );
  });

  it("defaults confidence to 0.5 when missing or invalid", () => {
    const base = {
      intent: "add_paragraph",
      proposed_text: "Étape 'X' — prérequis: y ; actions: z ; output: w.",
    };
    assert.equal(normalizeProposal(base)?.confidence, 0.5);
    assert.equal(
      normalizeProposal({ ...base, confidence: "high" })?.confidence,
      0.5,
    );
  });

  it("trims rationale and caps at 500 chars", () => {
    const long = "y".repeat(600);
    const out = normalizeProposal({
      intent: "add_paragraph",
      proposed_text: "Étape 'X' — prérequis: y ; actions: z ; output: w.",
      rationale: long,
      confidence: 0.8,
    });
    assert.equal(out?.rationale.length, 500);
  });

  it("rejects non-object input", () => {
    assert.equal(normalizeProposal(null), null);
    assert.equal(normalizeProposal("string"), null);
    assert.equal(normalizeProposal(42), null);
  });
});

describe("extractProcess", () => {
  const baseSignal = {
    source_type: "playbook_paste",
    source_text:
      "Le process : d'abord on qualifie via 2 questions sur leur outil actuel, puis on pitche seulement si pain confirmé, jamais avant.",
  };

  it("returns null on missing signal", async () => {
    assert.equal(await extractProcess(null), null);
    assert.equal(await extractProcess({}), null);
  });

  it("returns null on empty source_text", async () => {
    assert.equal(await extractProcess({ source_text: "" }), null);
    assert.equal(await extractProcess({ source_text: "   " }), null);
  });

  it("returns null on absurdly long source_text", async () => {
    const huge = "z".repeat(5000);
    assert.equal(await extractProcess({ source_text: huge }), null);
  });

  it("returns null without API key when no client injected", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      assert.equal(await extractProcess(baseSignal), null);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("parses a clean step proposal", async () => {
    const anthropic = makeClient([
      JSON.stringify({
        intent: "add_paragraph",
        proposed_text:
          "Étape 'qualification' — prérequis: première réponse ; actions: 2 questions max sur outil actuel ; output: lead scoré 0-3.",
        rationale: "User a décrit l'ordre du process explicitement.",
        confidence: 0.92,
      }),
    ]);
    const out = await extractProcess(baseSignal, { anthropic });
    assert.equal(out?.target_kind, "process");
    assert.equal(out?.intent, "add_paragraph");
    assert.equal(out?.confidence, 0.92);
  });

  it("parses a transition rule", async () => {
    const anthropic = makeClient([
      JSON.stringify({
        intent: "add_paragraph",
        proposed_text:
          "Ne pas passer à 'pitch' tant que le prospect n'a pas confirmé son pain point.",
        rationale: "Règle de transition du signal.",
        confidence: 0.85,
      }),
    ]);
    const out = await extractProcess(baseSignal, { anthropic });
    assert.equal(out?.intent, "add_paragraph");
    assert.equal(out?.target_kind, "process");
  });

  it("returns null on validation noise", async () => {
    const anthropic = makeClient([
      JSON.stringify({ extractable: false, reason: "user is just validating" }),
    ]);
    const out = await extractProcess(
      { source_type: "chat_correction", source_text: "ok parfait" },
      { anthropic },
    );
    assert.equal(out, null);
  });

  it("returns null when LLM correctly routes a writing rule to hard_rules", async () => {
    const anthropic = makeClient([
      JSON.stringify({
        extractable: false,
        reason: "max-questions limit is a hard_rule, not process",
      }),
    ]);
    const out = await extractProcess(
      {
        source_type: "chat_correction",
        source_text: "Jamais plus de 2 questions par message.",
      },
      { anthropic },
    );
    assert.equal(out, null);
  });

  it("retries once on parse-fail, then succeeds", async () => {
    const anthropic = makeClient([
      "this is prose, not json",
      JSON.stringify({
        intent: "add_paragraph",
        proposed_text:
          "Étape 'closing' — prérequis: 2 échanges qualifiants ; actions: proposer slot 30 min ; output: rdv calé.",
        rationale: "second attempt parsed",
        confidence: 0.7,
      }),
    ]);
    const out = await extractProcess(baseSignal, { anthropic });
    assert.equal(out?.intent, "add_paragraph");
    assert.equal(anthropic.calls, 2);
  });

  it("returns null when both attempts fail to parse", async () => {
    const anthropic = makeClient(["nope", "still nope"]);
    const out = await extractProcess(baseSignal, { anthropic });
    assert.equal(out, null);
    assert.equal(anthropic.calls, 2);
  });

  it("returns null on transport error (no retry)", async () => {
    const anthropic = makeClient([new Error("network down")]);
    const out = await extractProcess(baseSignal, { anthropic });
    assert.equal(out, null);
    assert.equal(anthropic.calls, 1);
  });

  it("respects a tight timeout", async () => {
    const slow = { messages: { create: () => new Promise(() => {}) } };
    const t0 = Date.now();
    const out = await extractProcess(baseSignal, { anthropic: slow, timeoutMs: 50 });
    assert.equal(out, null);
    assert.ok(Date.now() - t0 < 500);
  });

  it("rejects intent that doesn't apply to process (e.g. add_rule)", async () => {
    const anthropic = makeClient([
      JSON.stringify({
        intent: "add_rule",
        proposed_text: "Étape 'X' — prérequis: y.",
        confidence: 0.9,
      }),
    ]);
    const out = await extractProcess(baseSignal, { anthropic });
    assert.equal(out, null);
  });
});

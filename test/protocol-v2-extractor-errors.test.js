import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  extractError,
  normalizeProposal,
} from "../lib/protocol-v2-extractors/errors.js";

// Stub Anthropic client. queue is FIFO of either strings (text returned) or
// Error instances (thrown to simulate transport failure).
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

// ─────────────────────────────────────────────────────────────
// normalizeProposal — pure validation
// ─────────────────────────────────────────────────────────────

describe("normalizeProposal (errors)", () => {
  it("accepts a well-formed add_paragraph proposal", () => {
    const out = normalizeProposal({
      intent: "add_paragraph",
      proposed_text: "Évite 'n'hésitez pas' — préfère 'dis-moi si ça te parle'.",
      rationale: "User a remplacé la formulation dans la correction.",
      confidence: 0.9,
    });
    assert.deepEqual(out, {
      intent: "add_paragraph",
      target_kind: "errors",
      proposed_text: "Évite 'n'hésitez pas' — préfère 'dis-moi si ça te parle'.",
      rationale: "User a remplacé la formulation dans la correction.",
      confidence: 0.9,
    });
  });

  it("accepts amend_paragraph", () => {
    const out = normalizeProposal({
      intent: "amend_paragraph",
      proposed_text: "Évite 'parfait' — préfère rebondir directement.",
      confidence: 0.7,
    });
    assert.equal(out?.intent, "amend_paragraph");
    assert.equal(out?.target_kind, "errors");
  });

  it("returns null when extractable:false", () => {
    assert.equal(
      normalizeProposal({ extractable: false, reason: "validation msg" }),
      null,
    );
  });

  it("rejects intent specific to hard_rules", () => {
    assert.equal(
      normalizeProposal({
        intent: "add_rule",
        proposed_text: "Évite 'A' — préfère 'B'.",
        confidence: 0.9,
      }),
      null,
    );
  });

  it("rejects unknown intent", () => {
    assert.equal(
      normalizeProposal({
        intent: "refine_pattern",
        proposed_text: "Évite 'A' — préfère 'B'.",
        confidence: 0.8,
      }),
      null,
    );
  });

  it("returns null when proposed_text is missing or too short", () => {
    assert.equal(
      normalizeProposal({ intent: "add_paragraph", proposed_text: "" }),
      null,
    );
    assert.equal(
      normalizeProposal({ intent: "add_paragraph", proposed_text: "ab" }),
      null,
    );
    assert.equal(normalizeProposal({ intent: "add_paragraph" }), null);
  });

  it("returns null when proposed_text is absurdly long", () => {
    const long = "x".repeat(450);
    assert.equal(
      normalizeProposal({ intent: "add_paragraph", proposed_text: long, confidence: 0.9 }),
      null,
    );
  });

  it("clamps confidence to [0,1] and rounds to 2 decimals", () => {
    assert.equal(
      normalizeProposal({
        intent: "add_paragraph",
        proposed_text: "Évite 'A' — préfère 'B'.",
        confidence: 1.7,
      })?.confidence,
      1,
    );
    assert.equal(
      normalizeProposal({
        intent: "add_paragraph",
        proposed_text: "Évite 'A' — préfère 'B'.",
        confidence: -0.4,
      })?.confidence,
      0,
    );
    assert.equal(
      normalizeProposal({
        intent: "add_paragraph",
        proposed_text: "Évite 'A' — préfère 'B'.",
        confidence: 0.876543,
      })?.confidence,
      0.88,
    );
  });

  it("defaults confidence to 0.5 when missing or invalid", () => {
    assert.equal(
      normalizeProposal({
        intent: "add_paragraph",
        proposed_text: "Évite 'A' — préfère 'B'.",
      })?.confidence,
      0.5,
    );
    assert.equal(
      normalizeProposal({
        intent: "add_paragraph",
        proposed_text: "Évite 'A' — préfère 'B'.",
        confidence: "high",
      })?.confidence,
      0.5,
    );
  });

  it("trims rationale and caps at 500 chars", () => {
    const long = "y".repeat(600);
    const out = normalizeProposal({
      intent: "add_paragraph",
      proposed_text: "Évite 'A' — préfère 'B'.",
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

// ─────────────────────────────────────────────────────────────
// extractError — happy paths + error handling
// ─────────────────────────────────────────────────────────────

describe("extractError", () => {
  const baseSignal = {
    source_type: "chat_correction",
    source_text: "Tu écris 'n'hésitez pas à me contacter', remplace par 'dis-moi si ça te parle'.",
  };

  it("returns null on missing signal", async () => {
    assert.equal(await extractError(null), null);
    assert.equal(await extractError({}), null);
  });

  it("returns null on empty source_text", async () => {
    assert.equal(await extractError({ source_text: "" }), null);
    assert.equal(await extractError({ source_text: "   " }), null);
  });

  it("returns null on absurdly long source_text", async () => {
    const huge = "z".repeat(5000);
    const out = await extractError({ source_text: huge });
    assert.equal(out, null);
  });

  it("returns null without API key when no client injected", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const out = await extractError(baseSignal);
      assert.equal(out, null);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("parses a clean LLM response into a proposal", async () => {
    const anthropic = makeClient([
      JSON.stringify({
        intent: "add_paragraph",
        proposed_text: "Évite 'n'hésitez pas à me contacter' — préfère 'dis-moi si ça te parle'.",
        rationale: "User a remplacé la formulation explicitement.",
        confidence: 0.92,
      }),
    ]);
    const out = await extractError(baseSignal, { anthropic });
    assert.equal(out?.target_kind, "errors");
    assert.equal(out?.intent, "add_paragraph");
    assert.equal(out?.confidence, 0.92);
    assert.equal(anthropic.calls, 1);
  });

  it("returns null when LLM says extractable:false (e.g. validation signal)", async () => {
    const anthropic = makeClient([
      JSON.stringify({ extractable: false, reason: "user is validating, not correcting" }),
    ]);
    const out = await extractError(
      { source_type: "chat_correction", source_text: "ok parfait" },
      { anthropic },
    );
    assert.equal(out, null);
    assert.equal(anthropic.calls, 1);
  });

  it("retries once on parse-fail, then succeeds", async () => {
    const anthropic = makeClient([
      "this is not json at all, just prose explanation",
      JSON.stringify({
        intent: "add_paragraph",
        proposed_text: "Évite 'parfait' — préfère rebondir.",
        rationale: "second attempt parsed",
        confidence: 0.7,
      }),
    ]);
    const out = await extractError(baseSignal, { anthropic });
    assert.equal(out?.intent, "add_paragraph");
    assert.equal(anthropic.calls, 2);
  });

  it("returns null when both attempts fail to parse", async () => {
    const anthropic = makeClient([
      "explanation without json",
      "still not json",
    ]);
    const out = await extractError(baseSignal, { anthropic });
    assert.equal(out, null);
    assert.equal(anthropic.calls, 2);
  });

  it("returns null on transport error (no retry)", async () => {
    const anthropic = makeClient([new Error("network down")]);
    const out = await extractError(baseSignal, { anthropic });
    assert.equal(out, null);
    assert.equal(anthropic.calls, 1);
  });

  it("respects a tight timeout", async () => {
    const slowAnthropic = {
      messages: {
        create: () => new Promise(() => {}), // never resolves
      },
    };
    const t0 = Date.now();
    const out = await extractError(baseSignal, {
      anthropic: slowAnthropic,
      timeoutMs: 50,
    });
    const elapsed = Date.now() - t0;
    assert.equal(out, null);
    assert.ok(elapsed < 500, `should bail fast, took ${elapsed}ms`);
  });

  it("rejects intent that doesn't apply to errors (e.g. add_rule)", async () => {
    const anthropic = makeClient([
      JSON.stringify({
        intent: "add_rule",
        proposed_text: "Évite 'X' — préfère 'Y'.",
        rationale: "wrong target",
        confidence: 0.9,
      }),
    ]);
    const out = await extractError(baseSignal, { anthropic });
    assert.equal(out, null);
  });
});

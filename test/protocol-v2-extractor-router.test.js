import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  routeSignal,
  runExtractors,
  routeAndExtract,
} from "../lib/protocol-v2-extractor-router.js";
import { TARGET_KINDS } from "../lib/protocol-v2-extractors/index.js";

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

describe("routeSignal — guards", () => {
  it("returns [] on null/empty signal", async () => {
    assert.deepEqual(await routeSignal(null), []);
    assert.deepEqual(await routeSignal({}), []);
    assert.deepEqual(await routeSignal({ source_text: "" }), []);
    assert.deepEqual(await routeSignal({ source_text: "   " }), []);
  });

  it("returns [] without API key when no client and no static route", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const out = await routeSignal({
        source_type: "chat_correction",
        source_text: "max 2 questions par message",
      });
      assert.deepEqual(out, []);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});

describe("routeSignal — static routes", () => {
  it("routes 'rule_saved' directly to hard_rules without LLM call", async () => {
    const anthropic = makeClient([]); // would throw if called
    const out = await routeSignal(
      { source_type: "rule_saved", source_text: "max 2 questions" },
      { anthropic },
    );
    assert.deepEqual(out, [{ target_kind: "hard_rules", confidence: 1.0 }]);
    assert.equal(anthropic.calls, 0);
  });

  it("routes 'rule_dismissed' to hard_rules", async () => {
    const out = await routeSignal({
      source_type: "rule_dismissed",
      source_text: "this rule shouldn't apply here",
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].target_kind, "hard_rules");
  });

  it("routes 'hard_rule_correction' to hard_rules", async () => {
    const out = await routeSignal({
      source_type: "hard_rule_correction",
      source_text: "the rule fired but shouldn't have",
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].target_kind, "hard_rules");
  });
});

describe("routeSignal — LLM classifier", () => {
  it("parses single target_kind from LLM", async () => {
    const anthropic = makeClient([
      JSON.stringify({ target_kinds: [{ kind: "hard_rules", confidence: 0.92 }] }),
    ]);
    const out = await routeSignal(
      { source_type: "chat_correction", source_text: "max 2 questions par message" },
      { anthropic },
    );
    assert.deepEqual(out, [{ target_kind: "hard_rules", confidence: 0.92 }]);
  });

  it("parses multiple target_kinds (multi-aspect signal)", async () => {
    const anthropic = makeClient([
      JSON.stringify({
        target_kinds: [
          { kind: "hard_rules", confidence: 0.9 },
          { kind: "errors", confidence: 0.8 },
        ],
      }),
    ]);
    const out = await routeSignal(
      {
        source_type: "chat_correction",
        source_text: "max 2 questions et utilise 'dis-moi' au lieu de 'n'hésitez pas'",
      },
      { anthropic },
    );
    assert.equal(out.length, 2);
    assert.equal(out[0].target_kind, "hard_rules");
    assert.equal(out[1].target_kind, "errors");
  });

  it("returns [] when LLM says no target", async () => {
    const anthropic = makeClient([JSON.stringify({ target_kinds: [] })]);
    const out = await routeSignal(
      { source_type: "chat_correction", source_text: "ok parfait" },
      { anthropic },
    );
    assert.deepEqual(out, []);
  });

  it("filters unknown target_kind values", async () => {
    const anthropic = makeClient([
      JSON.stringify({
        target_kinds: [
          { kind: "made_up_kind", confidence: 0.9 },
          { kind: "errors", confidence: 0.7 },
        ],
      }),
    ]);
    const out = await routeSignal(
      { source_type: "chat_correction", source_text: "évite 'X' — préfère 'Y'" },
      { anthropic },
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].target_kind, "errors");
  });

  it("dedupes duplicate kinds, keeps first", async () => {
    const anthropic = makeClient([
      JSON.stringify({
        target_kinds: [
          { kind: "hard_rules", confidence: 0.8 },
          { kind: "hard_rules", confidence: 0.5 },
          { kind: "errors", confidence: 0.6 },
        ],
      }),
    ]);
    const out = await routeSignal(
      { source_type: "chat_correction", source_text: "..." },
      { anthropic },
    );
    assert.equal(out.length, 2);
    assert.equal(out[0].confidence, 0.8);
    assert.equal(out[1].target_kind, "errors");
  });

  it("caps at 2 target_kinds", async () => {
    const anthropic = makeClient([
      JSON.stringify({
        target_kinds: TARGET_KINDS.map((k) => ({ kind: k, confidence: 0.8 })),
      }),
    ]);
    const out = await routeSignal(
      { source_type: "chat_correction", source_text: "..." },
      { anthropic },
    );
    assert.equal(out.length, 2);
  });

  it("clamps confidence to [0,1] and rounds", () => {
    // tested indirectly via normalizeRouterOutput in next case
  });

  it("clamps confidence and rounds via output normalization", async () => {
    const anthropic = makeClient([
      JSON.stringify({
        target_kinds: [
          { kind: "hard_rules", confidence: 1.7 },
          { kind: "errors", confidence: 0.876543 },
        ],
      }),
    ]);
    const out = await routeSignal(
      { source_type: "chat_correction", source_text: "..." },
      { anthropic },
    );
    assert.equal(out[0].confidence, 1);
    assert.equal(out[1].confidence, 0.88);
  });

  it("returns [] when LLM returns malformed JSON", async () => {
    const anthropic = makeClient(["not json at all"]);
    const out = await routeSignal(
      { source_type: "chat_correction", source_text: "..." },
      { anthropic },
    );
    assert.deepEqual(out, []);
  });

  it("returns [] when LLM returns missing target_kinds field", async () => {
    const anthropic = makeClient([JSON.stringify({ wat: "no" })]);
    const out = await routeSignal(
      { source_type: "chat_correction", source_text: "..." },
      { anthropic },
    );
    assert.deepEqual(out, []);
  });

  it("returns [] on transport error", async () => {
    const anthropic = makeClient([new Error("network down")]);
    const out = await routeSignal(
      { source_type: "chat_correction", source_text: "..." },
      { anthropic },
    );
    assert.deepEqual(out, []);
  });

  it("respects tight timeout", async () => {
    const slow = { messages: { create: () => new Promise(() => {}) } };
    const t0 = Date.now();
    const out = await routeSignal(
      { source_type: "chat_correction", source_text: "..." },
      { anthropic: slow, timeoutMs: 50 },
    );
    assert.deepEqual(out, []);
    assert.ok(Date.now() - t0 < 500);
  });
});

describe("runExtractors", () => {
  const signal = { source_type: "chat_correction", source_text: "max 2 questions" };

  it("returns [] on missing signal or empty routes", async () => {
    assert.deepEqual(await runExtractors(null, []), []);
    assert.deepEqual(await runExtractors(signal, []), []);
    assert.deepEqual(await runExtractors(signal, null), []);
  });

  it("dispatches each route to the matching extractor", async () => {
    const fakeExtractors = {
      hard_rules: async () => ({
        intent: "add_rule",
        target_kind: "hard_rules",
        proposed_text: "Max 2 questions par message.",
        rationale: "...",
        confidence: 0.9,
      }),
      errors: async () => ({
        intent: "add_paragraph",
        target_kind: "errors",
        proposed_text: "Évite 'X' — préfère 'Y'.",
        rationale: "...",
        confidence: 0.7,
      }),
    };
    const routes = [
      { target_kind: "hard_rules", confidence: 0.9 },
      { target_kind: "errors", confidence: 0.7 },
    ];
    const out = await runExtractors(signal, routes, { extractors: fakeExtractors });
    assert.equal(out.length, 2);
    assert.equal(out[0].target_kind, "hard_rules");
    assert.equal(out[0].proposal.confidence, 0.9);
    assert.equal(out[1].target_kind, "errors");
  });

  it("filters null proposals (extractor returned null)", async () => {
    const fakeExtractors = {
      hard_rules: async () => null,
      errors: async () => ({
        intent: "add_paragraph",
        target_kind: "errors",
        proposed_text: "Évite 'X' — préfère 'Y'.",
        rationale: "...",
        confidence: 0.7,
      }),
    };
    const routes = [
      { target_kind: "hard_rules", confidence: 0.9 },
      { target_kind: "errors", confidence: 0.7 },
    ];
    const out = await runExtractors(signal, routes, { extractors: fakeExtractors });
    assert.equal(out.length, 1);
    assert.equal(out[0].target_kind, "errors");
  });

  it("skips unknown target_kind without crashing", async () => {
    const fakeExtractors = {
      errors: async () => ({
        intent: "add_paragraph",
        target_kind: "errors",
        proposed_text: "Évite 'X' — préfère 'Y'.",
        rationale: "...",
        confidence: 0.7,
      }),
    };
    const routes = [
      { target_kind: "made_up_kind", confidence: 0.9 },
      { target_kind: "errors", confidence: 0.7 },
    ];
    const out = await runExtractors(signal, routes, { extractors: fakeExtractors });
    assert.equal(out.length, 1);
    assert.equal(out[0].target_kind, "errors");
  });

  it("absorbs extractor exceptions, returns successful peers", async () => {
    const fakeExtractors = {
      hard_rules: async () => {
        throw new Error("boom");
      },
      errors: async () => ({
        intent: "add_paragraph",
        target_kind: "errors",
        proposed_text: "Évite 'X' — préfère 'Y'.",
        rationale: "...",
        confidence: 0.7,
      }),
    };
    const routes = [
      { target_kind: "hard_rules", confidence: 0.9 },
      { target_kind: "errors", confidence: 0.7 },
    ];
    const out = await runExtractors(signal, routes, { extractors: fakeExtractors });
    assert.equal(out.length, 1);
    assert.equal(out[0].target_kind, "errors");
  });

  it("forwards extractorOpts to each extractor", async () => {
    let captured = null;
    const fakeExtractors = {
      hard_rules: async (sig, opts) => {
        captured = opts;
        return null;
      },
    };
    await runExtractors(
      signal,
      [{ target_kind: "hard_rules", confidence: 0.9 }],
      { extractors: fakeExtractors, extractorOpts: { timeoutMs: 1234 } },
    );
    assert.equal(captured?.timeoutMs, 1234);
  });
});

describe("routeAndExtract — convenience", () => {
  it("routes then runs extractors end-to-end", async () => {
    const anthropic = makeClient([
      JSON.stringify({ target_kinds: [{ kind: "errors", confidence: 0.8 }] }),
    ]);
    const fakeExtractors = {
      errors: async () => ({
        intent: "add_paragraph",
        target_kind: "errors",
        proposed_text: "Évite 'X' — préfère 'Y'.",
        rationale: "...",
        confidence: 0.85,
      }),
    };
    const out = await routeAndExtract(
      { source_type: "chat_correction", source_text: "remplace 'X' par 'Y'" },
      {
        router: { anthropic },
        extractors: fakeExtractors,
      },
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].target_kind, "errors");
    assert.equal(out[0].proposal.confidence, 0.85);
  });

  it("returns [] when router returns no targets", async () => {
    const anthropic = makeClient([JSON.stringify({ target_kinds: [] })]);
    const out = await routeAndExtract(
      { source_type: "chat_correction", source_text: "ok parfait" },
      { router: { anthropic } },
    );
    assert.deepEqual(out, []);
  });
});

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { selectModel } from "../lib/model-router.js";

// Model IDs to match — the router reads CLAUDE_MODEL env for Sonnet at module load,
// so we check against the substring "haiku" vs "sonnet" rather than exact strings.
function isHaiku(model) { return /haiku/i.test(model); }
function isSonnet(model) { return /sonnet/i.test(model); }

const EMPTY = {
  message: "salut",
  knowledgeMatches: [],
  ontology: { directCount: 0 },
  corrections: null,
  scenario: "default",
};

describe("selectModel — thresholds & defaults", () => {
  it("routes to Haiku for a trivial chat message", () => {
    const r = selectModel(EMPTY);
    assert.ok(isHaiku(r.model), `expected haiku, got ${r.model}`);
    assert.equal(r.score, 0);
    assert.equal(r.reason, "simple_chat");
  });

  it("returns score and reason fields", () => {
    const r = selectModel(EMPTY);
    assert.ok("model" in r);
    assert.ok("score" in r);
    assert.ok("reason" in r);
  });
});

describe("selectModel — knowledge signal", () => {
  it("knowledge matches push score by 2", () => {
    const r = selectModel({ ...EMPTY, knowledgeMatches: [{ id: 1 }] });
    assert.equal(r.score, 2);
    assert.ok(r.reason.includes("knowledge:1"));
  });

  it("knowledge alone (score 2) stays on Haiku (threshold is 3)", () => {
    const r = selectModel({ ...EMPTY, knowledgeMatches: [{ id: 1 }, { id: 2 }] });
    assert.ok(isHaiku(r.model), `expected haiku at score 2, got ${r.model}`);
  });
});

describe("selectModel — ontology signal", () => {
  it("0 entities → no score contribution", () => {
    const r = selectModel({ ...EMPTY, ontology: { directCount: 0 } });
    assert.equal(r.score, 0);
  });

  it("1-2 entities → +1", () => {
    const r = selectModel({ ...EMPTY, ontology: { directCount: 2 } });
    assert.equal(r.score, 1);
  });

  it("3+ entities → +2", () => {
    const r = selectModel({ ...EMPTY, ontology: { directCount: 5 } });
    assert.equal(r.score, 2);
  });
});

describe("selectModel — message length signal", () => {
  it("short message contributes 0", () => {
    const r = selectModel({ ...EMPTY, message: "x".repeat(100) });
    assert.equal(r.score, 0);
  });

  it("long message (>300 chars) contributes 1", () => {
    const r = selectModel({ ...EMPTY, message: "x".repeat(301) });
    assert.equal(r.score, 1);
    assert.ok(r.reason.includes("long_msg"));
  });

  it("empty message does not crash and contributes 0", () => {
    const r = selectModel({ ...EMPTY, message: "" });
    assert.equal(r.score, 0);
  });
});

describe("selectModel — scenario signal", () => {
  it("qualification scenario adds 2", () => {
    const r = selectModel({ ...EMPTY, scenario: "qualification" });
    assert.equal(r.score, 2);
    assert.ok(r.reason.includes("scenario:qualification"));
  });

  it("post_creation scenario adds 2", () => {
    const r = selectModel({ ...EMPTY, scenario: "post_creation" });
    assert.equal(r.score, 2);
  });

  it("default scenario contributes 0", () => {
    const r = selectModel({ ...EMPTY, scenario: "default" });
    assert.equal(r.score, 0);
  });

  it("unknown scenario contributes 0", () => {
    const r = selectModel({ ...EMPTY, scenario: "made_up" });
    assert.equal(r.score, 0);
  });
});

describe("selectModel — corrections signal", () => {
  it("fewer than 16 corrections contribute 0", () => {
    const corrections = Array(10).fill("- **rule**: be concise").join("\n");
    const r = selectModel({ ...EMPTY, corrections });
    assert.equal(r.score, 0);
  });

  it("more than 15 corrections add 1", () => {
    const corrections = Array(20).fill("- **rule**: be concise").join("\n");
    const r = selectModel({ ...EMPTY, corrections });
    assert.equal(r.score, 1);
    assert.ok(r.reason.includes("many_corrections"));
  });

  it("null corrections contribute 0", () => {
    assert.equal(selectModel({ ...EMPTY, corrections: null }).score, 0);
  });

  it("corrections without expected prefix contribute 0", () => {
    const r = selectModel({ ...EMPTY, corrections: "no bullets here\nanother line" });
    assert.equal(r.score, 0);
  });
});

describe("selectModel — combined signals cross threshold", () => {
  it("knowledge (2) + 1-2 entities (1) = 3 → Sonnet", () => {
    const r = selectModel({
      ...EMPTY,
      knowledgeMatches: [{ id: 1 }],
      ontology: { directCount: 2 },
    });
    assert.equal(r.score, 3);
    assert.ok(isSonnet(r.model), `expected sonnet at score 3, got ${r.model}`);
  });

  it("qualification scenario alone (2) → Haiku", () => {
    const r = selectModel({ ...EMPTY, scenario: "qualification" });
    assert.ok(isHaiku(r.model), `expected haiku at score 2, got ${r.model}`);
  });

  it("qualification + long message → Sonnet", () => {
    const r = selectModel({
      ...EMPTY,
      scenario: "qualification",
      message: "x".repeat(400),
    });
    assert.equal(r.score, 3);
    assert.ok(isSonnet(r.model));
  });

  it("maxes out all signals without crashing", () => {
    const r = selectModel({
      message: "x".repeat(500),
      knowledgeMatches: [{ id: 1 }, { id: 2 }, { id: 3 }],
      ontology: { directCount: 10 },
      corrections: Array(20).fill("- **r**: x").join("\n"),
      scenario: "qualification",
    });
    assert.ok(r.score >= 3);
    assert.ok(isSonnet(r.model));
  });
});

describe("selectModel — robustness to missing fields", () => {
  it("undefined knowledgeMatches does not crash", () => {
    const r = selectModel({ ...EMPTY, knowledgeMatches: undefined });
    assert.ok(r.model);
  });

  it("undefined ontology does not crash", () => {
    const r = selectModel({ ...EMPTY, ontology: undefined });
    assert.ok(r.model);
  });

  it("undefined corrections does not crash", () => {
    const r = selectModel({ ...EMPTY, corrections: undefined });
    assert.ok(r.model);
  });
});

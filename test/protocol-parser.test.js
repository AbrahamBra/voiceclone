import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { normalizeRules } from "../lib/protocol-parser.js";

// normalizeRules() is the gatekeeper between raw Haiku tool-use output
// and DB insertion. Everything that can go wrong in a bad parse must
// be filtered here; otherwise protocolChecks.js throws at runtime.

describe("normalizeRules — check_kind: regex", () => {
  it("accepts a well-formed regex rule", () => {
    const out = normalizeRules([{
      rule_id: "no_offer_mention",
      description: "Jamais de mention offre/prix",
      check_kind: "regex",
      check_params: { pattern: "\\b(offre|prix)\\b", flags: "i", max_matches: 0 },
      source_quote: "Jamais de mention de l'offre",
    }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].check_kind, "regex");
    assert.equal(out[0].check_params.pattern, "\\b(offre|prix)\\b");
    assert.equal(out[0].check_params.flags, "i");
    assert.equal(out[0].check_params.max_matches, 0);
  });

  it("rejects a regex rule with invalid pattern", () => {
    const out = normalizeRules([{
      rule_id: "bad_regex",
      description: "bad",
      check_kind: "regex",
      check_params: { pattern: "[unclosed", flags: "", max_matches: 0 },
    }]);
    assert.equal(out.length, 0);
  });

  it("rejects a regex rule with missing pattern", () => {
    const out = normalizeRules([{
      rule_id: "empty",
      description: "x",
      check_kind: "regex",
      check_params: { flags: "i" },
    }]);
    assert.equal(out.length, 0);
  });

  it("defaults max_matches to 0 when not an integer", () => {
    const out = normalizeRules([{
      rule_id: "r",
      description: "d",
      check_kind: "regex",
      check_params: { pattern: "foo", flags: "i", max_matches: "nope" },
    }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].check_params.max_matches, 0);
  });
});

describe("normalizeRules — check_kind: counter", () => {
  it("accepts lines/questions/bullets", () => {
    const out = normalizeRules([
      { rule_id: "l", description: "d", check_kind: "counter", check_params: { what: "lines", max: 8 } },
      { rule_id: "q", description: "d", check_kind: "counter", check_params: { what: "questions", max: 1 } },
      { rule_id: "b", description: "d", check_kind: "counter", check_params: { what: "bullets", max: 0 } },
    ]);
    assert.equal(out.length, 3);
  });

  it("rejects unknown counter.what", () => {
    const out = normalizeRules([{
      rule_id: "x",
      description: "d",
      check_kind: "counter",
      check_params: { what: "paragraphs", max: 3 },
    }]);
    assert.equal(out.length, 0);
  });

  it("rejects negative or non-integer max", () => {
    const out = normalizeRules([
      { rule_id: "a", description: "d", check_kind: "counter", check_params: { what: "lines", max: -1 } },
      { rule_id: "b", description: "d", check_kind: "counter", check_params: { what: "lines", max: 2.5 } },
    ]);
    assert.equal(out.length, 0);
  });
});

describe("normalizeRules — check_kind: max_length", () => {
  it("accepts positive integer chars", () => {
    const out = normalizeRules([{
      rule_id: "m", description: "d", check_kind: "max_length", check_params: { chars: 300 },
    }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].check_params.chars, 300);
  });

  it("rejects zero or negative chars", () => {
    const out = normalizeRules([
      { rule_id: "a", description: "d", check_kind: "max_length", check_params: { chars: 0 } },
      { rule_id: "b", description: "d", check_kind: "max_length", check_params: { chars: -10 } },
    ]);
    assert.equal(out.length, 0);
  });
});

describe("normalizeRules — check_kind: structural", () => {
  it("accepts markdown_list/offer_mention/signature_complete", () => {
    const out = normalizeRules([
      { rule_id: "a", description: "d", check_kind: "structural", check_params: { deny: "markdown_list" } },
      { rule_id: "b", description: "d", check_kind: "structural", check_params: { deny: "offer_mention" } },
      { rule_id: "c", description: "d", check_kind: "structural", check_params: { deny: "signature_complete" } },
    ]);
    assert.equal(out.length, 3);
  });

  it("rejects unknown structural.deny", () => {
    const out = normalizeRules([{
      rule_id: "x", description: "d", check_kind: "structural", check_params: { deny: "emojis" },
    }]);
    assert.equal(out.length, 0);
  });
});

describe("normalizeRules — normalization", () => {
  it("slugifies rule_id and lowercases", () => {
    const out = normalizeRules([{
      rule_id: "Never Two Questions!",
      description: "d",
      check_kind: "counter",
      check_params: { what: "questions", max: 1 },
    }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].rule_id, "never_two_questions_");
  });

  it("dedupes on rule_id (keeps first)", () => {
    const out = normalizeRules([
      { rule_id: "same", description: "first", check_kind: "counter", check_params: { what: "lines", max: 8 } },
      { rule_id: "same", description: "second", check_kind: "counter", check_params: { what: "lines", max: 10 } },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].description, "first");
  });

  it("rejects rule without description", () => {
    const out = normalizeRules([{
      rule_id: "r", description: "", check_kind: "counter", check_params: { what: "lines", max: 8 },
    }]);
    assert.equal(out.length, 0);
  });

  it("rejects rule with unknown check_kind", () => {
    const out = normalizeRules([{
      rule_id: "r", description: "d", check_kind: "semantic", check_params: {},
    }]);
    assert.equal(out.length, 0);
  });

  it("defaults severity to 'hard' when missing or invalid", () => {
    const out = normalizeRules([
      { rule_id: "a", description: "d", check_kind: "counter", check_params: { what: "lines", max: 8 } },
      { rule_id: "b", description: "d", check_kind: "counter", check_params: { what: "lines", max: 8 }, severity: "critical" },
    ]);
    assert.equal(out[0].severity, "hard");
    assert.equal(out[1].severity, "hard");
  });

  it("preserves valid severity values", () => {
    const out = normalizeRules([
      { rule_id: "a", description: "d", check_kind: "counter", check_params: { what: "lines", max: 8 }, severity: "strong" },
      { rule_id: "b", description: "d", check_kind: "counter", check_params: { what: "lines", max: 8 }, severity: "light" },
    ]);
    assert.equal(out[0].severity, "strong");
    assert.equal(out[1].severity, "light");
  });

  it("preserves applies_to_scenarios array, nulls empty/invalid", () => {
    const out = normalizeRules([
      { rule_id: "a", description: "d", check_kind: "counter", check_params: { what: "lines", max: 8 }, applies_to_scenarios: ["DM_1st"] },
      { rule_id: "b", description: "d", check_kind: "counter", check_params: { what: "lines", max: 8 }, applies_to_scenarios: [] },
      { rule_id: "c", description: "d", check_kind: "counter", check_params: { what: "lines", max: 8 }, applies_to_scenarios: "not-array" },
    ]);
    assert.deepEqual(out[0].applies_to_scenarios, ["DM_1st"]);
    assert.equal(out[1].applies_to_scenarios, null);
    assert.equal(out[2].applies_to_scenarios, null);
  });

  it("truncates source_quote at 500 chars and description at 200", () => {
    const longQuote = "x".repeat(800);
    const longDesc = "y".repeat(400);
    const out = normalizeRules([{
      rule_id: "r", description: longDesc,
      check_kind: "counter", check_params: { what: "lines", max: 8 },
      source_quote: longQuote,
    }]);
    assert.equal(out[0].description.length, 200);
    assert.equal(out[0].source_quote.length, 500);
  });

  it("returns [] for non-array input", () => {
    assert.deepEqual(normalizeRules(null), []);
    assert.deepEqual(normalizeRules(undefined), []);
    assert.deepEqual(normalizeRules("string"), []);
    assert.deepEqual(normalizeRules({}), []);
  });

  it("skips null/non-object entries", () => {
    const out = normalizeRules([
      null,
      "string",
      { rule_id: "ok", description: "d", check_kind: "counter", check_params: { what: "lines", max: 8 } },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].rule_id, "ok");
  });
});

describe("process-setter.md fixture sanity", () => {
  // Smoke test: the fixture we'll feed to Haiku in integration contains
  // the absolute rules we expect the parser to find. If the fixture is
  // ever trimmed and loses these markers, the integration test below
  // becomes meaningless.
  const fixture = readFileSync("test/fixtures/process-setter.md", "utf8");

  it("contains the six absolute first-message rules", () => {
    assert.match(fixture, /Jamais deux questions dans le même message/);
    assert.match(fixture, /Jamais deux messages sans réponse intermédiaire/);
    assert.match(fixture, /Jamais de liste à puces/);
    assert.match(fixture, /Jamais de mention de l'offre/);
    assert.match(fixture, /Jamais plus de 8 lignes au total/);
    assert.match(fixture, /Toujours signer 'Nicolas'/);
  });
});

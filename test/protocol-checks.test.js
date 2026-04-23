import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { checkProtocolRules } from "../lib/protocolChecks.js";

function rule(partial) {
  return {
    rule_id: "r", description: "d", severity: "hard",
    applies_to_scenarios: null, source_quote: null,
    ...partial,
  };
}

describe("checkProtocolRules — counter", () => {
  it("flags >1 question when max=1", () => {
    const r = checkProtocolRules(
      "Tu viens d'où ? Et tu fais quoi ?",
      [rule({ rule_id: "no_two_q", check_kind: "counter", check_params: { what: "questions", max: 1 } })],
    );
    assert.equal(r.shouldRewrite, true);
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].rule_id, "no_two_q");
  });

  it("allows exactly 1 question when max=1", () => {
    const r = checkProtocolRules(
      "Tu viens d'où ?",
      [rule({ check_kind: "counter", check_params: { what: "questions", max: 1 } })],
    );
    assert.equal(r.shouldRewrite, false);
    assert.equal(r.violations.length, 0);
  });

  it("counts only non-empty lines (blanks ignored)", () => {
    // 8 non-empty + 1 blank → 8 lines → max=8 → passes (boundary).
    const text = "l1\nl2\nl3\n\nl5\nl6\nl7\nl8\nl9";
    const r = checkProtocolRules(text,
      [rule({ check_kind: "counter", check_params: { what: "lines", max: 8 } })]);
    assert.equal(r.shouldRewrite, false);
  });

  it("flags >max lines", () => {
    const text = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
    const r = checkProtocolRules(text,
      [rule({ check_kind: "counter", check_params: { what: "lines", max: 8 } })]);
    assert.equal(r.shouldRewrite, true);
    assert.match(r.violations[0].detail, /lines=10/);
  });

  it("counts bullets", () => {
    const text = "Voici:\n- un\n- deux\n- trois";
    const r = checkProtocolRules(text,
      [rule({ check_kind: "counter", check_params: { what: "bullets", max: 0 } })]);
    assert.equal(r.shouldRewrite, true);
    assert.match(r.violations[0].detail, /bullets=3/);
  });
});

describe("checkProtocolRules — regex", () => {
  it("flags offer mention", () => {
    const r = checkProtocolRules(
      "Je te propose mon accompagnement à 4000€/mois",
      [rule({ check_kind: "regex", check_params: {
        pattern: "\\b(offre|prix|accompagnement|euros?|€|tarif)\\b",
        flags: "i", max_matches: 0,
      } })],
    );
    assert.equal(r.shouldRewrite, true);
  });

  it("passes when pattern absent", () => {
    const r = checkProtocolRules(
      "Hello, tu viens d'où ?",
      [rule({ check_kind: "regex", check_params: {
        pattern: "\\b(offre|prix)\\b", flags: "i", max_matches: 0,
      } })],
    );
    assert.equal(r.shouldRewrite, false);
  });

  it("allows up to max_matches", () => {
    const r = checkProtocolRules(
      "foo bar foo",
      [rule({ check_kind: "regex", check_params: {
        pattern: "foo", flags: "", max_matches: 2,
      } })],
    );
    assert.equal(r.shouldRewrite, false);
  });
});

describe("checkProtocolRules — max_length", () => {
  it("flags text longer than chars", () => {
    const r = checkProtocolRules(
      "x".repeat(350),
      [rule({ check_kind: "max_length", check_params: { chars: 300 } })],
    );
    assert.equal(r.shouldRewrite, true);
    assert.match(r.violations[0].detail, /350 chars/);
  });

  it("allows text at or under limit", () => {
    const r = checkProtocolRules(
      "x".repeat(300),
      [rule({ check_kind: "max_length", check_params: { chars: 300 } })],
    );
    assert.equal(r.shouldRewrite, false);
  });
});

describe("checkProtocolRules — structural", () => {
  it("detects markdown_list", () => {
    const r = checkProtocolRules(
      "Les étapes:\n- une\n- deux",
      [rule({ check_kind: "structural", check_params: { deny: "markdown_list" } })],
    );
    assert.equal(r.shouldRewrite, true);
  });

  it("detects numbered list as markdown_list", () => {
    const r = checkProtocolRules(
      "1. Première\n2. Seconde",
      [rule({ check_kind: "structural", check_params: { deny: "markdown_list" } })],
    );
    assert.equal(r.shouldRewrite, true);
  });

  it("ignores single dash in prose", () => {
    const r = checkProtocolRules(
      "Je pense — très sincèrement — que c'est juste.",
      [rule({ check_kind: "structural", check_params: { deny: "markdown_list" } })],
    );
    assert.equal(r.shouldRewrite, false);
  });

  it("detects signature_complete (multi-line signoff)", () => {
    const r = checkProtocolRules(
      "Hello,\n\nNicolas Lavallée\nCoach entrepreneur\n06 12 34 56 78",
      [rule({ check_kind: "structural", check_params: { deny: "signature_complete" } })],
    );
    assert.equal(r.shouldRewrite, true);
  });

  it("allows first-name-only signature", () => {
    const r = checkProtocolRules(
      "À bientôt,\nNicolas",
      [rule({ check_kind: "structural", check_params: { deny: "signature_complete" } })],
    );
    assert.equal(r.shouldRewrite, false);
  });

  it("detects offer_mention fallback", () => {
    const r = checkProtocolRules(
      "Mon tarif est de 4000€",
      [rule({ check_kind: "structural", check_params: { deny: "offer_mention" } })],
    );
    assert.equal(r.shouldRewrite, true);
  });
});

describe("checkProtocolRules — scope / applies_to_scenarios", () => {
  const scopedRule = rule({
    check_kind: "counter",
    check_params: { what: "lines", max: 8 },
    applies_to_scenarios: ["DM_1st"],
  });

  it("fires when scenario matches", () => {
    const text = Array.from({ length: 10 }, () => "x").join("\n");
    const r = checkProtocolRules(text, [scopedRule], { scenario: "DM_1st" });
    assert.equal(r.shouldRewrite, true);
  });

  it("skips when scenario doesn't match", () => {
    const text = Array.from({ length: 10 }, () => "x").join("\n");
    const r = checkProtocolRules(text, [scopedRule], { scenario: "DM_reply" });
    assert.equal(r.shouldRewrite, false);
  });

  it("skips when no scenario provided but rule is scoped", () => {
    const text = Array.from({ length: 10 }, () => "x").join("\n");
    const r = checkProtocolRules(text, [scopedRule], {});
    assert.equal(r.shouldRewrite, false);
  });
});

describe("checkProtocolRules — severity", () => {
  it("non-hard severity produces violation but no rewrite", () => {
    const r = checkProtocolRules(
      "x".repeat(400),
      [rule({ severity: "strong", check_kind: "max_length", check_params: { chars: 300 } })],
    );
    assert.equal(r.shouldRewrite, false);
    assert.equal(r.violations.length, 1);
    assert.equal(r.violations[0].severity, "strong");
  });
});

describe("checkProtocolRules — edge cases", () => {
  it("returns empty for no rules", () => {
    const r = checkProtocolRules("anything", []);
    assert.deepEqual(r, { violations: [], shouldRewrite: false });
  });

  it("returns empty for empty text", () => {
    const r = checkProtocolRules("",
      [rule({ check_kind: "counter", check_params: { what: "lines", max: 1 } })]);
    assert.equal(r.violations.length, 0);
  });

  it("skips unknown check_kind silently", () => {
    const r = checkProtocolRules("anything",
      [rule({ check_kind: "semantic", check_params: {} })]);
    assert.equal(r.violations.length, 0);
  });

  it("aggregates multiple violations", () => {
    const text = "Ligne 1 ?\nLigne 2 ?\nLigne 3 ?\n- bullet";
    const r = checkProtocolRules(text, [
      rule({ rule_id: "q", check_kind: "counter", check_params: { what: "questions", max: 1 } }),
      rule({ rule_id: "md", check_kind: "structural", check_params: { deny: "markdown_list" } }),
    ]);
    assert.equal(r.violations.length, 2);
    assert.equal(r.shouldRewrite, true);
  });
});

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { computeContentHash, buildBackfillPlan } from "../scripts/backfill-protocol-v2.js";

describe("backfill — content_hash", () => {
  it("produces the same hash for two semantically-identical rules", () => {
    const r1 = {
      check_kind: "counter",
      check_params: { what: "questions", max: 1 },
      severity: "hard",
      applies_to_scenarios: ["DM_1st"],
    };
    const r2 = { ...r1, description: "different label", rule_id: "slug_diff" };
    assert.equal(computeContentHash(r1), computeContentHash(r2));
  });

  it("produces different hashes when check_params changes", () => {
    const r1 = { check_kind: "counter", check_params: { what: "questions", max: 1 }, severity: "hard", applies_to_scenarios: [] };
    const r2 = { check_kind: "counter", check_params: { what: "questions", max: 2 }, severity: "hard", applies_to_scenarios: [] };
    assert.notEqual(computeContentHash(r1), computeContentHash(r2));
  });
});

describe("backfill — buildBackfillPlan", () => {
  it("generates a complete plan for an existing protocol", () => {
    const protocol = {
      id: "op1", persona_id: "p1", version: 3, is_active: true,
      raw_document: null,
      rules: [
        { rule_id: "no_two_q", check_kind: "counter", check_params: { what: "questions", max: 1 }, severity: "hard", applies_to_scenarios: ["DM_1st"], source_quote: "Une seule question." },
      ],
    };
    const existingHashes = new Set();
    const plan = buildBackfillPlan(protocol, existingHashes);

    assert.equal(plan.document.owner_kind, "persona");
    assert.equal(plan.document.owner_id, "p1");
    assert.equal(plan.document.version, 3);
    assert.equal(plan.document.status, "active");
    assert.equal(plan.sections.length, 1);
    assert.equal(plan.sections[0].kind, "hard_rules");
    assert.equal(plan.artifacts.length, 1);
    assert.equal(plan.artifacts[0].kind, "hard_check");
    assert.equal(plan.artifacts[0].severity, "hard");
    assert.equal(plan.artifacts[0].content.check_kind, "counter");
    assert.ok(plan.artifacts[0].content_hash);
  });

  it("skips artifacts already present (content_hash match)", () => {
    const rule = { check_kind: "counter", check_params: { what: "questions", max: 1 }, severity: "hard", applies_to_scenarios: [] };
    const existingHash = computeContentHash(rule);
    const protocol = { id: "op1", persona_id: "p1", version: 1, is_active: false, raw_document: null, rules: [{ ...rule, rule_id: "r1" }] };
    const plan = buildBackfillPlan(protocol, new Set([existingHash]));
    assert.equal(plan.artifacts.length, 0, "existing artifact must be skipped");
  });

  it("uses deterministic prose fallback when raw_document is null", () => {
    const protocol = {
      id: "op1", persona_id: "p1", version: 1, is_active: false,
      raw_document: null,
      rules: [{ rule_id: "r1", check_kind: "counter", check_params: {}, severity: "hard", applies_to_scenarios: [] }],
    };
    const plan = buildBackfillPlan(protocol, new Set());
    assert.ok(plan.sections[0].prose.includes("Règles héritées"),
      "fallback prose must mention 'Règles héritées'");
  });
});

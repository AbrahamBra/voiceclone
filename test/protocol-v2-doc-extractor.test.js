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

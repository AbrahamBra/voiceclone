import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { applyConfidenceDecay, formatCorrectionsWithDecay } from "../lib/correction-decay.js";
import { looksLikeNegativeFeedback } from "../lib/feedback-detect.js";

describe("applyConfidenceDecay", () => {
  it("returns full confidence for today's correction", () => {
    const result = applyConfidenceDecay(0.8, new Date().toISOString());
    assert.ok(result >= 0.75 && result <= 0.8);
  });

  it("decays over 120 days", () => {
    const d60ago = new Date(Date.now() - 60 * 86400000).toISOString();
    const result = applyConfidenceDecay(0.8, d60ago);
    assert.ok(result < 0.8, `expected < 0.8, got ${result}`);
    assert.ok(result > 0.3, `expected > 0.3, got ${result}`);
  });

  it("floors at 30% of original confidence", () => {
    const d200ago = new Date(Date.now() - 200 * 86400000).toISOString();
    const result = applyConfidenceDecay(0.8, d200ago);
    assert.equal(result, 0.24); // 0.8 * 0.3
  });

  it("high-confidence corrections decay slower", () => {
    const d60ago = new Date(Date.now() - 60 * 86400000).toISOString();
    const high = applyConfidenceDecay(1.0, d60ago);
    const low = applyConfidenceDecay(0.5, d60ago);
    assert.ok(high > low);
  });
});

describe("formatCorrectionsWithDecay", () => {
  it("filters out corrections below EFFECTIVE_FLOOR (0.15)", () => {
    const corrections = [
      { correction: "Rule A", created_at: new Date().toISOString(), confidence: 0.8, status: "active" },
      { correction: "Rule B", created_at: new Date(Date.now() - 200 * 86400000).toISOString(), confidence: 0.2, status: "active" },
    ];
    const result = formatCorrectionsWithDecay(corrections);
    assert.ok(result.includes("Rule A"));
    assert.ok(!result.includes("Rule B"));
  });

  it("sorts by effective confidence DESC", () => {
    const corrections = [
      { correction: "Old rule", created_at: new Date(Date.now() - 90 * 86400000).toISOString(), confidence: 0.8, status: "active" },
      { correction: "New rule", created_at: new Date().toISOString(), confidence: 0.8, status: "active" },
    ];
    const result = formatCorrectionsWithDecay(corrections);
    const oldIdx = result.indexOf("Old rule");
    const newIdx = result.indexOf("New rule");
    assert.ok(newIdx < oldIdx, "new rule should come first");
  });

  it("excludes archived corrections", () => {
    const corrections = [
      { correction: "Active", created_at: new Date().toISOString(), confidence: 0.8, status: "active" },
      { correction: "Archived", created_at: new Date().toISOString(), confidence: 0.8, status: "archived" },
    ];
    const result = formatCorrectionsWithDecay(corrections);
    assert.ok(result.includes("Active"));
    assert.ok(!result.includes("Archived"));
  });
});

describe("looksLikeNegativeFeedback", () => {
  it("detects 'oublie cette regle'", () => {
    assert.ok(looksLikeNegativeFeedback("oublie cette regle"));
  });

  it("detects 'c'etait mieux avant'", () => {
    assert.ok(looksLikeNegativeFeedback("c'etait mieux avant"));
  });

  it("detects 'annule la derniere correction'", () => {
    assert.ok(looksLikeNegativeFeedback("annule la derniere correction"));
  });

  it("rejects normal messages", () => {
    assert.ok(!looksLikeNegativeFeedback("Envoie un message a Sophie"));
  });

  it("rejects long messages", () => {
    assert.ok(!looksLikeNegativeFeedback("oublie cette regle " + "x".repeat(300)));
  });
});

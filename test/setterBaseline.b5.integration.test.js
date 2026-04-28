import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { evaluateRhythm } from "../lib/critic/rhythmCritic.js";

describe("B5 shadow signal propagation through evaluateRhythm", () => {
  it("propagates B5 into signals.setter_shadow_ids when persona has no tutoiement_default", () => {
    // Persona muette sur tutoiement_default + pas de message lead → vouvoiement
    // par défaut s'applique. Clone tutoie → B5 doit fire en shadow et remonter
    // dans signals.setter_shadow_ids (consommé par persistShadow → rhythm_shadow).
    const result = evaluateRhythm("Salut, tu vas bien ?", {
      persona: {},
    });
    assert.ok(result, "evaluateRhythm should return a result");
    assert.ok(Array.isArray(result.signals.setter_shadow_ids),
      "signals.setter_shadow_ids should be an array");
    assert.ok(result.signals.setter_shadow_ids.includes("B5"),
      `B5 should be in setter_shadow_ids, got ${JSON.stringify(result.signals.setter_shadow_ids)}`);
    assert.equal(result.signals.setter_shadow_count, result.signals.setter_shadow_ids.length,
      "setter_shadow_count must match setter_shadow_ids length");
  });

  it("does not propagate B5 when persona.tutoiement_default=true", () => {
    const result = evaluateRhythm("Salut, tu vas bien ?", {
      persona: { tutoiement_default: true },
    });
    assert.ok(!result.signals.setter_shadow_ids.includes("B5"),
      "B5 should NOT fire when tutoiement_default=true and lead is silent");
  });
});

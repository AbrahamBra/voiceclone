import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { evaluateSetterBaseline } from "../lib/critic/setterBaseline.js";

describe("B5 vouvoiement par défaut (shadow)", () => {
  it("does not contribute to violationScore (shadow)", () => {
    const r = evaluateSetterBaseline("Salut, tu vas bien ?");
    const inShadow = r.shadowViolations.find(v => v.id === "B5");
    const inActive = r.violations.find(v => v.id === "B5");
    assert.ok(inShadow, "B5 should fire in shadowViolations");
    assert.ok(!inActive, "B5 should NOT contribute to violations[]");
  });

  it("does not fire when clone vouvoie", () => {
    const r = evaluateSetterBaseline("Bonjour, comment allez-vous ?");
    assert.ok(!r.shadowViolations.find(v => v.id === "B5"));
  });

  it("does not fire when lead initiated tutoiement (miroir)", () => {
    const r = evaluateSetterBaseline(
      "Salut, ça roule pour toi ?",
      { priorLeadMessage: "Hello, tu peux m'expliquer ce que tu fais ?" }
    );
    assert.ok(!r.shadowViolations.find(v => v.id === "B5"));
  });

  it("fires when lead vouvoyed but clone tutoyes (miroir miss)", () => {
    const r = evaluateSetterBaseline(
      "Salut, ça roule pour toi ?",
      { priorLeadMessage: "Bonjour, pouvez-vous m'expliquer votre offre ?" }
    );
    assert.ok(r.shadowViolations.find(v => v.id === "B5"));
  });

  it("does not fire when persona has tutoiement_default override", () => {
    const r = evaluateSetterBaseline(
      "Salut, tu vas bien ?",
      { persona: { tutoiement_default: true } }
    );
    assert.ok(!r.shadowViolations.find(v => v.id === "B5"));
  });

  it("override is bypassed when lead vouvoyed (mirror always wins)", () => {
    const r = evaluateSetterBaseline(
      "Salut, ça roule pour toi ?",
      {
        priorLeadMessage: "Bonjour, vous proposez quoi exactement ?",
        persona: { tutoiement_default: true },
      }
    );
    assert.ok(r.shadowViolations.find(v => v.id === "B5"));
  });

  it("does not fire on homonyme: 'ton' substantif", () => {
    // homonyme: 'ton' substantif (et non pronom possessif) ne doit pas déclencher B5
    const r = evaluateSetterBaseline("Mon ton est plus ferme aujourd'hui");
    assert.ok(!r.shadowViolations.find(v => v.id === "B5"));
  });
});

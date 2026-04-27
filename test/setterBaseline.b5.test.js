import { describe, it, expect } from "vitest";
import { evaluateSetterBaseline } from "../lib/critic/setterBaseline.js";

describe("B5 vouvoiement par défaut (shadow)", () => {
  it("does not contribute to violationScore (shadow)", () => {
    // Tutoiement sans signal lead, sans override → shadow violation, pas de score
    const r = evaluateSetterBaseline("Salut, tu vas bien ?");
    expect(r.shadowViolations.find(v => v.id === "B5")).toBeTruthy();
    // maxScore ne doit PAS inclure le poids de B5
    const ratio = r.violations.find(v => v.id === "B5");
    expect(ratio).toBeUndefined();
  });

  it("does not fire when clone vouvoie", () => {
    const r = evaluateSetterBaseline("Bonjour, comment allez-vous ?");
    expect(r.shadowViolations.find(v => v.id === "B5")).toBeFalsy();
  });

  it("does not fire when lead initiated tutoiement (miroir)", () => {
    const r = evaluateSetterBaseline(
      "Salut, ça roule pour toi ?",
      { priorLeadMessage: "Hello, tu peux m'expliquer ce que tu fais ?" }
    );
    expect(r.shadowViolations.find(v => v.id === "B5")).toBeFalsy();
  });

  it("fires when lead vouvoyed but clone tutoyes (miroir miss)", () => {
    const r = evaluateSetterBaseline(
      "Salut, ça roule pour toi ?",
      { priorLeadMessage: "Bonjour, pouvez-vous m'expliquer votre offre ?" }
    );
    expect(r.shadowViolations.find(v => v.id === "B5")).toBeTruthy();
  });

  it("does not fire when persona has tutoiement_default override", () => {
    const r = evaluateSetterBaseline(
      "Salut, tu vas bien ?",
      { persona: { tutoiement_default: true } }
    );
    expect(r.shadowViolations.find(v => v.id === "B5")).toBeFalsy();
  });

  it("override is bypassed when lead vouvoyed (mirror always wins)", () => {
    const r = evaluateSetterBaseline(
      "Salut, ça roule pour toi ?",
      {
        priorLeadMessage: "Bonjour, vous proposez quoi exactement ?",
        persona: { tutoiement_default: true },
      }
    );
    expect(r.shadowViolations.find(v => v.id === "B5")).toBeTruthy();
  });
});

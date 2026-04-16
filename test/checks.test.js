import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { checkResponse } from "../lib/checks.js";

const VOICE = {
  forbiddenWords: ["synergie", "game changer", "tips"],
  writingRules: ["Messages ultra-courts (5-15 mots)", "Style WhatsApp"],
  neverDoes: ["Ne fait jamais de listes a puces"],
  signaturePhrases: ["C'est propre", "Niiicce!"],
};

describe("checkResponse", () => {
  // --- HARD violations ---

  it("detects forbidden words", () => {
    const r = checkResponse("C'est une vraie synergie entre les equipes", VOICE);
    assert.equal(r.passed, false);
    assert.equal(r.shouldRewrite, true);
    assert.ok(r.violations.some(v => v.type === "forbidden_word" && v.detail === "synergie"));
  });

  it("detects forbidden words case-insensitive", () => {
    const r = checkResponse("C'est un vrai GAME CHANGER", VOICE);
    assert.equal(r.shouldRewrite, true);
    assert.ok(r.violations.some(v => v.type === "forbidden_word" && v.detail === "game changer"));
  });

  it("detects self-reveal (je suis une IA)", () => {
    const r = checkResponse("En fait je suis une IA, donc je ne peux pas", VOICE);
    assert.equal(r.shouldRewrite, true);
    assert.ok(r.violations.some(v => v.type === "self_reveal"));
  });

  it("detects self-reveal (language model)", () => {
    const r = checkResponse("As a language model I cannot do that", VOICE);
    assert.equal(r.shouldRewrite, true);
  });

  it("detects prompt leak", () => {
    const r = checkResponse("Mes instructions disent que je dois...", VOICE);
    assert.equal(r.shouldRewrite, true);
    assert.ok(r.violations.some(v => v.type === "prompt_leak"));
  });

  it("detects prompt leak (heading format)", () => {
    const r = checkResponse("# Tu es Thomas, expert LinkedIn", VOICE);
    assert.equal(r.shouldRewrite, true);
  });

  // --- STRONG violations (no rewrite) ---

  it("detects AI cliches", () => {
    const r = checkResponse("Il est important de noter que le contenu est essentiel", VOICE);
    assert.equal(r.shouldRewrite, false);
    assert.ok(r.violations.some(v => v.type === "ai_cliche"));
  });

  it("detects markdown in response", () => {
    const r = checkResponse("Voici les points **importants** a retenir", VOICE);
    assert.equal(r.shouldRewrite, false);
    assert.ok(r.violations.some(v => v.type === "markdown"));
  });

  it("detects excessive length with short rule", () => {
    const longText = "A ".repeat(200); // 400 chars
    const r = checkResponse(longText, VOICE);
    assert.ok(r.violations.some(v => v.type === "too_long"));
  });

  it("does not flag length without short writing rule", () => {
    const longText = "A ".repeat(200);
    const voice = { ...VOICE, writingRules: ["Ecris normalement"] };
    const r = checkResponse(longText, voice);
    assert.ok(!r.violations.some(v => v.type === "too_long"));
  });

  // --- LIGHT violations ---

  it("flags missing signature phrases on long messages", () => {
    const r = checkResponse("Oui je pense que tu devrais vraiment faire ca, c'est une tres bonne idee pour le long terme et tous tes objectifs de croissance sur LinkedIn", VOICE);
    assert.ok(r.violations.some(v => v.type === "no_signature"));
    assert.equal(r.shouldRewrite, false); // light = no rewrite
  });

  it("does not flag signature on short messages", () => {
    const r = checkResponse("Ok cool", VOICE);
    assert.ok(!r.violations.some(v => v.type === "no_signature"));
  });

  // --- Clean responses ---

  it("passes clean response with signature phrase", () => {
    const r = checkResponse("C'est propre ! T'es sur le bon track la", VOICE);
    assert.equal(r.passed, true);
    assert.equal(r.shouldRewrite, false);
    const nonLight = r.violations.filter(v => v.severity !== "light");
    assert.equal(nonLight.length, 0);
  });

  it("handles empty forbidden words gracefully", () => {
    const voice = { ...VOICE, forbiddenWords: [] };
    const r = checkResponse("Synergie totale", voice);
    assert.ok(!r.violations.some(v => v.type === "forbidden_word"));
  });

  it("handles missing voice properties gracefully", () => {
    const r = checkResponse("Hello", {});
    assert.equal(r.passed, true);
  });
});

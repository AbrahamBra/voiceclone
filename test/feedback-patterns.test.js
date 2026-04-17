import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  looksLikeNegativeFeedback,
  looksLikeDirectInstruction,
} from "../lib/feedback-detect.js";

// --- looksLikeNegativeFeedback ---

describe("looksLikeNegativeFeedback", () => {
  it("matches 'oublie cette regle'", () => {
    assert.equal(looksLikeNegativeFeedback("oublie cette règle"), true);
  });

  it("matches 'annule la derniere'", () => {
    assert.equal(looksLikeNegativeFeedback("annule la dernière correction"), true);
  });

  it("matches 'c'était mieux avant'", () => {
    assert.equal(looksLikeNegativeFeedback("c'était mieux avant"), true);
  });

  it("matches 'supprime cette regle'", () => {
    assert.equal(looksLikeNegativeFeedback("supprime cette règle"), true);
  });

  it("matches 'retire la regle'", () => {
    assert.equal(looksLikeNegativeFeedback("retire la règle de vouvoiement"), true);
  });

  it("does NOT match positive validation", () => {
    assert.equal(looksLikeNegativeFeedback("ok top c'est parfait"), false);
  });

  it("does NOT match a simple chat message", () => {
    assert.equal(looksLikeNegativeFeedback("écris-moi un post sur l'onboarding"), false);
  });

  it("does NOT match a direct instruction", () => {
    assert.equal(looksLikeNegativeFeedback("ajoute une règle: toujours tutoyer"), false);
  });

  it("returns false for empty or null message", () => {
    assert.equal(looksLikeNegativeFeedback(""), false);
    assert.equal(looksLikeNegativeFeedback(null), false);
    assert.equal(looksLikeNegativeFeedback(undefined), false);
  });

  it("returns false for messages exceeding MAX_NEGATIVE_LENGTH (200 chars)", () => {
    const long = "oublie cette règle ".repeat(30); // > 200 chars, still contains pattern
    assert.ok(long.length > 200);
    assert.equal(looksLikeNegativeFeedback(long), false);
  });

  it("is case-insensitive", () => {
    assert.equal(looksLikeNegativeFeedback("OUBLIE CETTE RÈGLE"), true);
  });
});

// --- looksLikeDirectInstruction ---

describe("looksLikeDirectInstruction", () => {
  it("matches 'ne jamais ...'", () => {
    assert.equal(looksLikeDirectInstruction("ne jamais commencer par un emoji"), true);
  });

  // Fixed previously — BUG #1 (regex required single-char word after "toujours").
  // Now matches multi-char words as intended.
  it("matches 'toujours a ...'", () => {
    assert.equal(looksLikeDirectInstruction("toujours a faire ça"), true);
  });

  it("matches 'toujours tutoyer par défaut'", () => {
    assert.equal(looksLikeDirectInstruction("toujours tutoyer par défaut"), true);
  });

  it("matches 'ajoute une regle : ...'", () => {
    assert.equal(looksLikeDirectInstruction("ajoute une règle: phrases courtes"), true);
  });

  it("matches 'desormais ...'", () => {
    assert.equal(looksLikeDirectInstruction("désormais, commence tous les messages par 'Yo'"), true);
  });

  it("matches 'retiens ca'", () => {
    assert.equal(looksLikeDirectInstruction("retiens ça: pas d'emoji en fin de phrase"), true);
  });

  // Fixed previously — BUG #2 (\b in ASCII mode blocked the accented form).
  // Regex now uses (?<!\w)...(?!\w) which works for both "a" and "à".
  it("matches 'a partir de maintenant' (without accent)", () => {
    assert.equal(looksLikeDirectInstruction("a partir de maintenant tutoie toujours"), true);
  });

  it("matches 'à partir de maintenant' (with accent)", () => {
    assert.equal(looksLikeDirectInstruction("à partir de maintenant tutoie"), true);
  });

  it("does NOT match a coaching correction", () => {
    assert.equal(looksLikeDirectInstruction("trop long"), false);
  });

  it("does NOT match a simple chat message", () => {
    assert.equal(looksLikeDirectInstruction("écris-moi un post"), false);
  });

  it("does NOT match a negative feedback message", () => {
    assert.equal(looksLikeDirectInstruction("oublie cette règle"), false);
  });

  it("returns false for empty or null message", () => {
    assert.equal(looksLikeDirectInstruction(""), false);
    assert.equal(looksLikeDirectInstruction(null), false);
  });

  it("returns false for messages exceeding MAX_INSTRUCTION_LENGTH (2000 chars)", () => {
    const long = "ne jamais ".repeat(250); // > 2000 chars
    assert.ok(long.length > 2000);
    assert.equal(looksLikeDirectInstruction(long), false);
  });

  it("is case-insensitive", () => {
    assert.equal(looksLikeDirectInstruction("NE JAMAIS écrire en MAJUSCULES"), true);
  });
});

// --- Cross-pattern exclusivity (regression guard) ---

describe("pattern exclusivity", () => {
  // These are cases where the two detectors SHOULD NOT both fire.
  // If a regression makes both return true, the short-circuit logic in chat.js
  // becomes ambiguous.
  it("'oublie cette règle' is negative-only, not instruction", () => {
    assert.equal(looksLikeNegativeFeedback("oublie cette règle"), true);
    assert.equal(looksLikeDirectInstruction("oublie cette règle"), false);
  });

  it("'toujours tutoyer' is instruction-only, not negative", () => {
    assert.equal(looksLikeDirectInstruction("toujours tutoyer"), true);
    assert.equal(looksLikeNegativeFeedback("toujours tutoyer"), false);
  });

  it("'trop long' is neither (it is a coaching correction)", () => {
    assert.equal(looksLikeNegativeFeedback("trop long"), false);
    assert.equal(looksLikeDirectInstruction("trop long"), false);
  });
});

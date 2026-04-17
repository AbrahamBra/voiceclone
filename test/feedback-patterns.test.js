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

  // NOTE — known regex quirk (BUG #1 in feedback-detect.js INSTRUCTION_PATTERN):
  // The alternative `toujours\s+\w\b` requires a SINGLE-char word after "toujours"
  // because `\w` is followed by `\b`. So "toujours tutoyer" does NOT match but
  // "toujours a" does. Likely intent was `\w+\b`. See flagged regression below.
  it("matches 'toujours a ...' (current behaviour — regex expects single-char word)", () => {
    assert.equal(looksLikeDirectInstruction("toujours a faire ça"), true);
  });

  it("does NOT match 'toujours tutoyer' (BUG: should match, does not)", () => {
    // Documents the current bug. When the regex is fixed to `\w+\b`, flip this to true.
    assert.equal(looksLikeDirectInstruction("toujours tutoyer par défaut"), false);
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

  // NOTE — known regex quirk (BUG #2 in INSTRUCTION_PATTERN):
  // `\b[àa]\s+partir...` — \b (ASCII) doesn't match between a non-word char and "à"
  // because "à" is not a word character in JS's default (non-Unicode) regex engine.
  // So "à partir de maintenant" doesn't match, but "a partir de maintenant" (no accent) does.
  // Likely intent: use a Unicode flag, or match literally without leading word boundary.
  it("matches 'a partir de maintenant' (without accent — current behaviour)", () => {
    assert.equal(looksLikeDirectInstruction("a partir de maintenant tutoie toujours"), true);
  });

  it("does NOT match 'à partir de maintenant' (BUG: accent blocks word boundary)", () => {
    assert.equal(looksLikeDirectInstruction("à partir de maintenant tutoie"), false);
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

  it("'a partir de maintenant x' is instruction-only, not negative", () => {
    assert.equal(looksLikeDirectInstruction("a partir de maintenant tutoie"), true);
    assert.equal(looksLikeNegativeFeedback("a partir de maintenant tutoie"), false);
  });

  it("'trop long' is neither (it is a coaching correction)", () => {
    assert.equal(looksLikeNegativeFeedback("trop long"), false);
    assert.equal(looksLikeDirectInstruction("trop long"), false);
  });
});

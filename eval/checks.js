import { readFileSync } from "fs";
import { join } from "path";

const persona = JSON.parse(
  readFileSync(join(process.cwd(), "persona", "persona.json"), "utf-8")
);
const v = persona.voice;

export function noForbiddenWords(text) {
  const lower = text.toLowerCase();
  const found = v.forbiddenWords.filter((w) => lower.includes(w.toLowerCase()));
  return {
    pass: found.length === 0,
    detail: found.length > 0 ? `Forbidden words found: ${found.join(", ")}` : "OK",
  };
}

export function noExcessiveExclamation(text) {
  const count = (text.match(/!/g) || []).length;
  return {
    pass: count <= 1,
    detail: count > 1 ? `${count} exclamation marks found` : "OK",
  };
}

export function responseInFrench(text) {
  const frenchWords = ["le", "la", "les", "de", "du", "des", "un", "une", "et", "est", "que", "qui", "dans", "pour", "pas", "vous", "ce", "cette"];
  const words = text.toLowerCase().split(/\s+/);
  const frenchCount = words.filter((w) => frenchWords.includes(w)).length;
  const ratio = frenchCount / words.length;
  return {
    pass: ratio > 0.05,
    detail: ratio > 0.05 ? "OK" : `Low French word ratio: ${(ratio * 100).toFixed(1)}%`,
  };
}

export function reasonableLength(text) {
  const words = text.split(/\s+/).length;
  return {
    pass: words >= 10 && words <= 500,
    detail: words < 10 ? `Too short: ${words} words` : words > 500 ? `Too long: ${words} words` : "OK",
  };
}

export function noSelfReference(text) {
  const lower = text.toLowerCase();
  const refs = ["je suis une ia", "en tant qu'ia", "je suis un assistant", "language model", "openai", "chatgpt"];
  const found = refs.filter((r) => lower.includes(r));
  return {
    pass: found.length === 0,
    detail: found.length > 0 ? `Self-reference found: ${found.join(", ")}` : "OK",
  };
}

export function hasStructuredAudit(text) {
  const hasScore = /\d+\/25|\d+\/5/.test(text);
  const hasRecommendation = text.toLowerCase().includes("recommandation") || text.toLowerCase().includes("conseil");
  return {
    pass: hasScore && hasRecommendation,
    detail: !hasScore ? "Missing score format (X/25 or X/5)" : !hasRecommendation ? "Missing recommendations" : "OK",
  };
}

export const ALL_CHECKS = {
  noForbiddenWords,
  noExcessiveExclamation,
  responseInFrench,
  reasonableLength,
  noSelfReference,
  hasStructuredAudit,
};

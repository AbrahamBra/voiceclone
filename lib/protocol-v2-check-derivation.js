// Protocol v2 — derive a runtime check_kind + check_params from a hard
// rule's prose text.
//
// Called at proposition accept time (api/v2/propositions.js
// → materializeArtifact) so an active artifact carries something the
// runtime can actually test (lib/protocolChecks.js expects
// {check_kind, check_params} on each rule, see audit
// docs/audits/protocol-underutilization-2026-05-01.md §2).
//
// Fast path: regex / counter heuristics on common French DM-rule
// formulations (cheap, deterministic, no LLM). LLM fallback for the
// rest.
//
// Shape returned :
//   {check_kind, check_params}   — usable by lib/protocolChecks.js
//   null                         — couldn't derive, artifact stored
//                                  without runtime params (graceful)
//
// check_kind enum (must match lib/protocolChecks.js dispatch) :
//   regex      : { pattern, flags?, max_matches? }
//   counter    : { what: 'questions'|'lines'|'bullets', max: number }
//   max_length : { chars: number }
//   structural : { deny: 'markdown_list'|'signature_complete'|'offer_mention' }

import Anthropic from "@anthropic-ai/sdk";
import { parseJsonFromText } from "./claude-helpers.js";
import { log } from "./log.js";

const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_MAX_TOKENS = 256;
const DEFAULT_TIMEOUT_MS = 6000;

/**
 * Try a handful of regex patterns that cover ~80% of the rules our
 * extractors produce. Returns null when no heuristic applies.
 *
 * Pure / sync / exported for tests.
 */
export function deriveCheckParamsHeuristic(ruleText) {
  if (typeof ruleText !== "string" || !ruleText.trim()) return null;
  const t = ruleText.trim();

  // "Max N lignes" / "Pas plus de N lignes" / "Jamais plus de N lignes"
  const lines = t.match(/(?:max|pas plus de|jamais plus de)\s+(\d+)\s+lignes?/i);
  if (lines) {
    return { check_kind: "counter", check_params: { what: "lines", max: parseInt(lines[1], 10) } };
  }

  // "Max N questions" / "Jamais plus de N questions" / "Pas plus de N questions"
  const questions = t.match(/(?:max|pas plus de|jamais plus de)\s+(\d+)\s+questions?/i);
  if (questions) {
    return { check_kind: "counter", check_params: { what: "questions", max: parseInt(questions[1], 10) } };
  }

  // "Jamais deux/trois/N questions" or "Jamais plus de deux/... questions"
  const wordToNum = { "deux": 2, "trois": 3, "quatre": 4, "cinq": 5 };
  const wordQ = t.match(/jamais\s+(?:plus\s+de\s+)?(deux|trois|quatre|cinq)\s+questions?/i);
  if (wordQ) {
    // "jamais X questions" → max = X - 1 (strictly less than X).
    // "jamais plus de X questions" → max = X (allowed up to X).
    const isPlusDe = /jamais\s+plus\s+de/i.test(t);
    const num = wordToNum[wordQ[1].toLowerCase()];
    return { check_kind: "counter", check_params: { what: "questions", max: isPlusDe ? num : num - 1 } };
  }

  // "Une seule question par message" / "Une question par message" / "Maximum une question"
  if (/(?:une\s+seule|une|max(?:imum)?\s+une)\s+questions?\s+par\s+message/i.test(t)) {
    return { check_kind: "counter", check_params: { what: "questions", max: 1 } };
  }

  // "Max N caractères" / "Pas plus de N caractères"
  const chars = t.match(/(?:max|pas plus de|jamais plus de)\s+(\d+)\s+(?:caract[eè]res?|chars?)/i);
  if (chars) {
    return { check_kind: "max_length", check_params: { chars: parseInt(chars[1], 10) } };
  }

  // "Jamais de liste à puces" / "Pas de liste à puces" / "Pas de listes à puces"
  if (/(?:jamais|pas)\s+de\s+listes?\s+(?:à\s+)?puces?/i.test(t)) {
    return { check_kind: "structural", check_params: { deny: "markdown_list" } };
  }

  // "Pas de signature complète" / "Jamais de signature complète"
  if (/(?:jamais|pas)\s+de\s+signature\s+compl[eè]te/i.test(t)) {
    return { check_kind: "structural", check_params: { deny: "signature_complete" } };
  }

  // "Jamais de mention de l'offre / du prix / du mot accompagnement"
  // Match catch-all variants with optional commas + "ou" between.
  if (/jamais\s+(?:de\s+mention|mentionner)\b.*\b(offre|prix|tarif|accompagnement)/i.test(t)) {
    return { check_kind: "structural", check_params: { deny: "offer_mention" } };
  }

  // "Ne jamais commencer par '...'" → regex anchored to message start.
  // Match quote pairs explicitly so the apostrophe inside a French phrase
  // (e.g. "J'espère") doesn't close the capture early.
  //   "..."   : ASCII straight double quotes
  //   "..."   : Unicode left/right double quotation marks
  //   « ... » : French guillemets (with optional inner spaces)
  // We intentionally skip single straight quotes — too ambiguous in French.
  const startsWithQuoted =
    t.match(/(?:ne\s+jamais|jamais)\s+commencer\s+par\s+(?:"([^"]+)"|"([^"]+)"|«\s*([^»]+?)\s*»)/i);
  if (startsWithQuoted) {
    const phrase = (startsWithQuoted[1] || startsWithQuoted[2] || startsWithQuoted[3] || "").trim();
    if (phrase.length > 0 && phrase.length < 80) {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return {
        check_kind: "regex",
        check_params: {
          pattern: `^\\s*${escaped}`,
          flags: "i",
          max_matches: 0,
        },
      };
    }
  }

  return null;
}

const LLM_SYSTEM_PROMPT = `Tu es un convertisseur déterministe : tu prends une règle absolue (en français, formulée comme une interdiction ou une borne supérieure) et tu produis sa version testable programmatiquement par 4 dispatchers existants.

Dispatchers disponibles :
- regex      : { pattern, flags?, max_matches? }      — pattern JS RegExp en string. Pour "ne jamais X" tu utilises max_matches=0.
- counter    : { what: "questions"|"lines"|"bullets", max: number }   — uniquement ces 3 compteurs sont câblés.
- max_length : { chars: number }                      — longueur totale du message
- structural : { deny: "markdown_list"|"signature_complete"|"offer_mention" }   — uniquement ces 3 patterns structurels sont câblés.

Si la règle parle :
  - de nombre de questions/lignes/puces → counter
  - de longueur en caractères → max_length
  - de liste markdown / signature / offre-prix → structural
  - d'un mot précis ou d'une formulation à éviter → regex max_matches:0
  - d'autre chose qu'aucun dispatcher ne sait tester → renvoie {extractable: false}

Réponds UNIQUEMENT en JSON brut, format :
{"check_kind":"counter","check_params":{"what":"questions","max":2}}
ou
{"extractable":false,"reason":"..."}`;

function buildLlmUserMessage(ruleText) {
  return `Règle : "${ruleText.slice(0, 500)}"\n\nRenvoie le JSON {check_kind, check_params} ou {extractable:false}.`;
}

const VALID_KINDS = new Set(["regex", "counter", "max_length", "structural"]);

function normalizeLlmOutput(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.extractable === false) return null;
  const kind = typeof raw.check_kind === "string" ? raw.check_kind : null;
  if (!kind || !VALID_KINDS.has(kind)) return null;
  const params = raw.check_params;
  if (!params || typeof params !== "object") return null;

  // Per-kind shape validation : we'd rather return null than store
  // garbage params that lib/protocolChecks.js silently skips.
  switch (kind) {
    case "counter": {
      const what = ["questions", "lines", "bullets"].includes(params.what) ? params.what : null;
      const max = Number.isFinite(params.max) ? params.max : null;
      if (!what || max === null || max < 0) return null;
      return { check_kind: "counter", check_params: { what, max } };
    }
    case "max_length": {
      const chars = Number.isFinite(params.chars) ? params.chars : null;
      if (chars === null || chars <= 0) return null;
      return { check_kind: "max_length", check_params: { chars } };
    }
    case "structural": {
      const deny = ["markdown_list", "signature_complete", "offer_mention"].includes(params.deny) ? params.deny : null;
      if (!deny) return null;
      return { check_kind: "structural", check_params: { deny } };
    }
    case "regex": {
      const pattern = typeof params.pattern === "string" && params.pattern ? params.pattern : null;
      if (!pattern) return null;
      // Try to compile. Bad regex from the LLM = drop entire derivation
      // rather than a runtime crash on every chat turn.
      try { new RegExp(pattern); } catch { return null; }
      const flags = typeof params.flags === "string" ? params.flags : undefined;
      const max_matches = Number.isFinite(params.max_matches) ? params.max_matches : 0;
      return { check_kind: "regex", check_params: { pattern, ...(flags ? { flags } : {}), max_matches } };
    }
    default:
      return null;
  }
}

async function callDeriveLLM({ anthropic, model, maxTokens, timeoutMs, ruleText }) {
  return Promise.race([
    anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system: LLM_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildLlmUserMessage(ruleText) }],
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("derive_timeout")), timeoutMs)),
  ]);
}

function extractText(result) {
  const block = result?.content?.find?.((b) => b?.type === "text");
  return typeof block?.text === "string" ? block.text : "";
}

/**
 * Derive {check_kind, check_params} from a rule's prose. Heuristic first,
 * LLM fallback. Returns null when neither path produces a usable shape.
 *
 * @param {string} ruleText
 * @param {object} [opts]
 * @param {object} [opts.anthropic]   — pre-built client (tests inject mock)
 * @param {string} [opts.apiKey]
 * @param {string} [opts.model]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.skipLlm=false]   — heuristic-only path (used by
 *                                           backfill scripts in dry-run)
 */
export async function deriveCheckParams(ruleText, opts = {}) {
  const heuristic = deriveCheckParamsHeuristic(ruleText);
  if (heuristic) return heuristic;
  if (opts.skipLlm) return null;

  let anthropic = opts.anthropic;
  if (!anthropic) {
    const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    anthropic = new Anthropic({ apiKey });
  }

  try {
    const result = await callDeriveLLM({
      anthropic,
      model: opts.model || DEFAULT_MODEL,
      maxTokens: opts.maxTokens || DEFAULT_MAX_TOKENS,
      timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      ruleText,
    });
    const raw = parseJsonFromText(extractText(result));
    return normalizeLlmOutput(raw);
  } catch (err) {
    log("protocol_v2_derive_check_params_error", { message: err?.message || String(err) });
    return null;
  }
}

// Re-export for tests / backfill use cases that need just the validator.
export { normalizeLlmOutput };

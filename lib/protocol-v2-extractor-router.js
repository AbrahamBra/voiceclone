// Router pour les extracteurs protocole v2.
//
// À partir d'un signal { source_type, source_text, context }, décide vers
// quel(s) extracteur(s) router et exécute la (les) extraction(s) en parallèle.
//
// Stratégie en deux temps :
//   1. Routage statique pour les `source_type` à signal fort (ex: 'rule_saved'
//      → hard_rules direct).
//   2. Sinon, appel LLM léger (claude-haiku-4-5, 2s timeout) qui retourne 0-2
//      target_kinds avec confidence. Un signal multi-aspect peut alimenter
//      plusieurs sections (ex: correction "max 2 questions et utilise 'dis-moi'"
//      → hard_rules + errors).
//
// API :
//   await routeSignal(signal, opts)       → Array<{target_kind, confidence}>
//   await runExtractors(signal, routes, opts) → Array<{target_kind, proposal}>
//                                                (proposals null filtrés)
//
// CALLERS (post recall fix, see lib/protocol-v2-doc-extractor.js) :
//   - api/v2/protocol/extract.js                 — feedback_event consolidation
//   - api/v2/protocol/source-playbooks.js        — per-source-core playbook extraction
//   - api/v2/protocol/import-doc.js              — explicit extractTargets path only
//                                                  (icp_audience, positioning).
//                                                  The null/generic path now uses
//                                                  lib/protocol-v2-doc-extractor.js
//                                                  (single Sonnet tool_use call) to
//                                                  avoid the prose-narrative gating
//                                                  that produced ~5% recall on
//                                                  Nicolas process-setter.md.

import Anthropic from "@anthropic-ai/sdk";
import { parseJsonFromText } from "./claude-helpers.js";
import { EXTRACTORS, TARGET_KINDS } from "./protocol-v2-extractors/index.js";
import { log } from "./log.js";

const ROUTER_MODEL = "claude-haiku-4-5";
const ROUTER_MAX_TOKENS = 256;
const ROUTER_TIMEOUT_MS = 2000;
const ROUTER_MAX_TARGETS = 2;

const TARGET_KINDS_SET = new Set(TARGET_KINDS);

// Static rules : si on connaît avec confiance le target_kind d'avance, on
// court-circuite l'appel LLM. Source : spec §5.1.
const STATIC_ROUTES = Object.freeze({
  rule_saved: [{ target_kind: "hard_rules", confidence: 1.0 }],
  rule_dismissed: [{ target_kind: "hard_rules", confidence: 0.9 }],
  hard_rule_correction: [{ target_kind: "hard_rules", confidence: 0.95 }],
});

export const ROUTER_SYSTEM_PROMPT = `Tu es un classifier qui route un signal d'apprentissage vers la bonne section d'un protocole opérationnel pour clone IA LinkedIn.

Sections disponibles (target_kind) :
- hard_rules : règles testables programmatiquement (max N, jamais X, interdit absolu chiffré ou de mot précis)
- errors : paires "évite X — préfère Y" (formulations spécifiques à remplacer)
- icp_patterns : taxonomie des profils prospects (signaux + question-clé)
- scoring : axes de score 0-3 OU règles de décision basées sur un score
- process : étapes du process commercial avec prérequis/actions/outputs ou transitions
- templates : skeletons de message par scénario avec slots ordonnés

Un signal peut alimenter PLUSIEURS sections (ex: "max 2 questions et utilise 'dis-moi' au lieu de 'n'hésitez pas'" → hard_rules ET errors). Mais limite à 2 target_kinds maximum, les plus pertinents.

Si le signal est :
- Une validation pure ("ok parfait", "top") → []
- Une formulation ambiguë ou trop vague → []
- Hors scope du protocole (info technique, bug rapport) → []

Réponds UNIQUEMENT en JSON brut (pas de markdown).

Format :
{"target_kinds":[{"kind":"hard_rules","confidence":0.85}]}
ou
{"target_kinds":[{"kind":"hard_rules","confidence":0.7},{"kind":"errors","confidence":0.6}]}
ou
{"target_kinds":[]}`;

function buildRouterUserMessage(signal) {
  const { source_type, source_text, context } = signal;
  const lines = [];
  lines.push(`Type de signal : ${source_type || "inconnu"}`);

  const ctx = context && typeof context === "object" ? context : {};
  if (typeof ctx.last_bot_msg === "string" && ctx.last_bot_msg.trim()) {
    lines.push(`Dernier draft bot :\n"${ctx.last_bot_msg.slice(0, 300)}"`);
  }

  lines.push(`Texte du signal :\n"${(source_text || "").slice(0, 1000)}"`);
  lines.push("Renvoie UNIQUEMENT le JSON {target_kinds:[...]} avec 0 à 2 entrées.");
  return lines.join("\n\n");
}

function normalizeRouterOutput(raw) {
  if (!raw || typeof raw !== "object") return [];
  const arr = Array.isArray(raw.target_kinds) ? raw.target_kinds : [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const kind = typeof item.kind === "string" ? item.kind.trim() : null;
    if (!kind || !TARGET_KINDS_SET.has(kind) || seen.has(kind)) continue;

    let confidence = 0.5;
    if (typeof item.confidence === "number" && Number.isFinite(item.confidence)) {
      confidence = Math.max(0, Math.min(1, item.confidence));
      confidence = Number(confidence.toFixed(2));
    }
    out.push({ target_kind: kind, confidence });
    seen.add(kind);
    if (out.length >= ROUTER_MAX_TARGETS) break;
  }
  return out;
}

async function callRouterLLM({ anthropic, model, maxTokens, timeoutMs, userMsg }) {
  return Promise.race([
    anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system: ROUTER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMsg }],
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("router_timeout")), timeoutMs),
    ),
  ]);
}

function extractText(result) {
  const block = result?.content?.find?.((b) => b?.type === "text");
  return typeof block?.text === "string" ? block.text : "";
}

/**
 * Route un signal vers 0-2 target_kinds.
 *
 * @param {{source_type:string, source_text:string, context?:object}} signal
 * @param {object} [opts]
 * @param {object} [opts.anthropic]
 * @param {string} [opts.apiKey]
 * @param {string} [opts.model]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<Array<{target_kind:string, confidence:number}>>}
 */
export async function routeSignal(signal, opts = {}) {
  if (!signal || typeof signal !== "object") return [];
  const source_text = typeof signal.source_text === "string" ? signal.source_text.trim() : "";
  if (!source_text) return [];

  // 1. Routage statique
  const sourceType = typeof signal.source_type === "string" ? signal.source_type : "";
  if (STATIC_ROUTES[sourceType]) {
    return STATIC_ROUTES[sourceType].map((r) => ({ ...r }));
  }

  // 2. Classifier LLM léger
  const model = opts.model || ROUTER_MODEL;
  const maxTokens = opts.maxTokens || ROUTER_MAX_TOKENS;
  const timeoutMs = opts.timeoutMs ?? ROUTER_TIMEOUT_MS;

  let anthropic = opts.anthropic;
  if (!anthropic) {
    const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return [];
    anthropic = new Anthropic({ apiKey });
  }

  const userMsg = buildRouterUserMessage({ ...signal, source_text });

  try {
    const result = await callRouterLLM({ anthropic, model, maxTokens, timeoutMs, userMsg });
    const raw = parseJsonFromText(extractText(result));
    if (!raw) {
      log("protocol_v2_router_parse_fail", { source_type: sourceType });
      return [];
    }
    return normalizeRouterOutput(raw);
  } catch (err) {
    log("protocol_v2_router_error", { message: err.message });
    return [];
  }
}

/**
 * Exécute les extracteurs pour un ensemble de routes (Promise.all parallèle).
 * Filtre les proposals null. Renvoie [] si aucune route ou aucun extracteur ne produit.
 *
 * @param {object} signal — passé tel quel à chaque extracteur
 * @param {Array<{target_kind:string, confidence?:number}>} routes
 * @param {object} [opts]
 * @param {object} [opts.extractors] — override pour les tests (defaut = EXTRACTORS)
 * @param {object} [opts.extractorOpts] — opts forwardés à chaque extracteur
 * @returns {Promise<Array<{target_kind:string, proposal:object}>>}
 */
export async function runExtractors(signal, routes, opts = {}) {
  if (!signal || !Array.isArray(routes) || routes.length === 0) return [];

  const map = opts.extractors || EXTRACTORS;
  const extractorOpts = opts.extractorOpts || {};

  const promises = routes.map(async (route) => {
    const fn = map[route?.target_kind];
    if (typeof fn !== "function") return null;
    try {
      const proposal = await fn(signal, extractorOpts);
      if (!proposal) return null;
      return { target_kind: route.target_kind, proposal };
    } catch (err) {
      log("protocol_v2_extractor_run_error", {
        target_kind: route.target_kind,
        message: err.message,
      });
      return null;
    }
  });

  const settled = await Promise.all(promises);
  return settled.filter(Boolean);
}

/**
 * Convenience : route + extract en un seul call.
 *
 * @param {object} signal
 * @param {object} [opts] — routerOpts via opts.router, extractorOpts via opts.extractor
 * @returns {Promise<Array<{target_kind:string, proposal:object}>>}
 */
export async function routeAndExtract(signal, opts = {}) {
  const routes = await routeSignal(signal, opts.router || {});
  if (routes.length === 0) return [];
  return runExtractors(signal, routes, {
    extractors: opts.extractors,
    extractorOpts: opts.extractor || {},
  });
}

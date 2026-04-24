// Extractor LLM spécialisé pour la section `hard_rules` du protocole vivant.
//
// Prend un signal (correction, instruction directe, regen_rejection...) et
// propose — si pertinent — un amendement à la section `hard_rules` du doc.
// La conversion du rule_text en artifact `hard_check` (check_kind, check_params)
// se fait à l'accept (Task 4.3). Ici on produit juste la prose testable.
//
// Contract (Task 2.2 du plan protocole-vivant) :
//   Input  : { source_type, source_text, context }
//   Output : { intent, target_kind: 'hard_rules', proposed_text, rationale, confidence } | null
//
// Null = rien d'extractible comme hard_rule (le signal peut convenir à un
// autre extracteur — router géré par Task 2.5, pas ici).

import Anthropic from "@anthropic-ai/sdk";
import { parseJsonFromText } from "../claude-helpers.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_SOURCE_TEXT = 4000;
const MAX_PROPOSED_TEXT = 400;
const MIN_PROPOSED_TEXT = 4;

const VALID_INTENTS = new Set(["add_rule", "amend_paragraph", "remove_rule"]);

export const HARD_RULES_SYSTEM_PROMPT = `Tu es un extracteur spécialisé pour la section "hard_rules" du protocole opérationnel d'un clone IA LinkedIn.

Une HARD RULE est une règle absolue, atomique, **testable programmatiquement** avant envoi d'un message. Exemples valides :
- "Jamais plus de deux questions dans un même message"
- "Max 8 lignes au total dans un DM"
- "Jamais de mention de l'offre, du prix, ou du mot 'accompagnement'"
- "Jamais de liste à puces dans un message"
- "Ne jamais commencer par 'J'espère que tu vas bien'"

Ne sont PAS des hard rules :
- Conseils de tonalité ou de style général ("sois naturel", "écris en prose", "sois chaleureux")
- Pattern ICP ou critère de scoring ("les prospects seniors répondent mieux")
- Étapes d'un process ("d'abord qualifier puis pitcher")
- Préférences subjectives sans test automatisable

À partir du signal fourni, décide :
1. Si le signal mérite une proposition de hard_rule → renvoie un candidat.
2. Sinon → renvoie \`{"extractable": false, "reason": "..."}\`.

Quand tu proposes :
- \`intent\` ∈ {"add_rule", "amend_paragraph", "remove_rule"}
  · add_rule = nouvelle contrainte absolue à ajouter
  · amend_paragraph = une règle existante doit être reformulée/nuancée
  · remove_rule = une règle existante doit être retirée (user l'a contredite)
- \`proposed_text\` : formulation canonique française, impérative, concise (≤ 200 chars), prête à devenir rule_text. Ex: "Jamais plus de deux questions par message."
- \`rationale\` : pourquoi, sourcé au signal. Ex: "User a corrigé 'trois questions' dans la dernière réponse bot."
- \`confidence\` : 0.0-1.0, ta certitude que c'est bien une hard rule absolue (pas un conseil de style).

RÈGLES :
- Si le signal est une validation ("ok top", "parfait") → extractable:false.
- Si le signal est un simple conseil de ton ("plus chaleureux", "trop long" sans chiffre) → extractable:false (appartient à patterns/errors, pas hard_rules).
- Si le signal mentionne un nombre précis (max N questions, N lignes, N chars) → extractable avec confidence élevée.
- Si le signal est une interdiction claire ("jamais X", "ne X pas", "interdit de X") → extractable.
- Si ambigu → extractable:false plutôt qu'inventer.

Réponds UNIQUEMENT en JSON brut (pas de markdown, pas de texte hors JSON).

Format si extractable :
{"intent":"add_rule","proposed_text":"...","rationale":"...","confidence":0.85}

Format si non extractable :
{"extractable":false,"reason":"..."}`;

/**
 * Valide + normalise la sortie brute de l'extracteur.
 * Export pur — testable sans API.
 *
 * @param {unknown} raw  — objet parsé depuis le JSON renvoyé par le modèle
 * @returns {{intent,target_kind,proposed_text,rationale,confidence}|null}
 */
export function normalizeProposal(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.extractable === false) return null;

  const intent = typeof raw.intent === "string" ? raw.intent.trim() : null;
  if (!intent || !VALID_INTENTS.has(intent)) return null;

  const proposed_text = typeof raw.proposed_text === "string" ? raw.proposed_text.trim() : "";
  if (proposed_text.length < MIN_PROPOSED_TEXT) return null;
  if (proposed_text.length > MAX_PROPOSED_TEXT) return null;

  const rationale = typeof raw.rationale === "string" ? raw.rationale.trim().slice(0, 500) : "";

  let confidence = 0.5;
  if (typeof raw.confidence === "number" && Number.isFinite(raw.confidence)) {
    confidence = Math.max(0, Math.min(1, raw.confidence));
    confidence = Number(confidence.toFixed(2));
  }

  return {
    intent,
    target_kind: "hard_rules",
    proposed_text,
    rationale,
    confidence,
  };
}

function buildUserMessage(signal) {
  const { source_type, source_text, context } = signal;
  const lines = [];
  lines.push(`Type de signal : ${source_type || "correction"}`);

  const ctx = context && typeof context === "object" ? context : {};
  if (typeof ctx.last_bot_msg === "string" && ctx.last_bot_msg.trim()) {
    lines.push(`Dernière réponse du bot :\n"${ctx.last_bot_msg.slice(0, 600)}"`);
  }
  if (typeof ctx.draft_text === "string" && ctx.draft_text.trim()) {
    lines.push(`Draft concerné :\n"${ctx.draft_text.slice(0, 600)}"`);
  }
  if (Array.isArray(ctx.entities) && ctx.entities.length) {
    const tags = ctx.entities.filter(e => typeof e === "string").slice(0, 10);
    if (tags.length) lines.push(`Entités matchées : ${tags.join(", ")}`);
  }
  if (typeof ctx.existing_rules_excerpt === "string" && ctx.existing_rules_excerpt.trim()) {
    lines.push(`Règles existantes (extrait) :\n${ctx.existing_rules_excerpt.slice(0, 800)}`);
  }

  lines.push(`Texte du signal :\n"${source_text.slice(0, MAX_SOURCE_TEXT)}"`);
  lines.push("Réponds uniquement en JSON selon le format spécifié.");
  return lines.join("\n\n");
}

async function callOnce({ anthropic, model, maxTokens, timeoutMs, userMsg }) {
  return Promise.race([
    anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system: HARD_RULES_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMsg }],
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("extractor_timeout")), timeoutMs),
    ),
  ]);
}

function extractText(result) {
  const block = result?.content?.find?.(b => b?.type === "text");
  return typeof block?.text === "string" ? block.text : "";
}

/**
 * Extrait une proposition de hard_rule à partir d'un signal.
 * Retourne null si rien d'extractible, ou en cas d'erreur (timeout, parse fail, etc.).
 *
 * Retry : parse-fail → 1 retry. Les autres erreurs (timeout, réseau) bailent directement.
 *
 * @param {{source_type:string, source_text:string, context?:object}} signal
 * @param {object} [opts]
 * @param {object} [opts.anthropic]  — client injectable pour les tests
 * @param {string} [opts.apiKey]
 * @param {string} [opts.model]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<object|null>}
 */
export async function extractHardRule(signal, opts = {}) {
  if (!signal || typeof signal !== "object") return null;
  const source_text = typeof signal.source_text === "string" ? signal.source_text.trim() : "";
  if (!source_text) return null;
  if (source_text.length > MAX_SOURCE_TEXT) return null;

  const model = opts.model || DEFAULT_MODEL;
  const maxTokens = opts.maxTokens || DEFAULT_MAX_TOKENS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let anthropic = opts.anthropic;
  if (!anthropic) {
    const apiKey = opts.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    anthropic = new Anthropic({ apiKey });
  }

  const userMsg = buildUserMessage({ ...signal, source_text });

  try {
    // Attempt 1
    let result = await callOnce({ anthropic, model, maxTokens, timeoutMs, userMsg });
    let raw = parseJsonFromText(extractText(result));

    // Retry 1x uniquement si parse échoue (pas sur timeout — déjà throw).
    if (!raw) {
      result = await callOnce({ anthropic, model, maxTokens, timeoutMs, userMsg });
      raw = parseJsonFromText(extractText(result));
    }
    if (!raw) return null;

    return normalizeProposal(raw);
  } catch {
    return null;
  }
}

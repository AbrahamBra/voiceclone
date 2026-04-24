// Extractor LLM spécialisé pour la section `icp_patterns` du protocole vivant.
//
// Prend un signal et propose — si pertinent — un amendement à la section
// `icp_patterns` du doc. L'icp_patterns est une TAXONOMIE des profils prospects :
// chaque pattern = nom + signaux observables + question-clé qualifiante.
//
// Contract (Task 2.4a du plan protocole-vivant) :
//   Input  : { source_type, source_text, context }
//   Output : { intent, target_kind: 'icp_patterns', proposed_text, rationale, confidence } | null
//
// Null = rien d'extractible comme pattern ICP. Les règles d'écriture vont à
// hard_rules/errors, les axes de scoring à scoring — router géré par Task 2.5.

import Anthropic from "@anthropic-ai/sdk";
import { parseJsonFromText } from "../claude-helpers.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_SOURCE_TEXT = 4000;
const MAX_PROPOSED_TEXT = 600;
const MIN_PROPOSED_TEXT = 12;

const VALID_INTENTS = new Set(["add_paragraph", "amend_paragraph", "refine_pattern"]);

export const PATTERNS_SYSTEM_PROMPT = `Tu es un extracteur spécialisé pour la section "icp_patterns" du protocole opérationnel d'un clone IA LinkedIn.

La section icp_patterns est une **taxonomie des profils prospects** du user. Chaque pattern décrit UN archétype de prospect avec :
- un **nom** (archétype identifiable, ex : "Fondateur SaaS B2B seed", "Consultant solo 5+ ans", "Head of Growth scaleup")
- des **signaux observables** sur LinkedIn (taille boîte, levée, titre, ancienneté, activité, secteur…)
- une **question-clé** qui qualifie ou disqualifie le profil en conversation (ex : "tu gères toi-même ta prospection ou tu as un SDR ?")

Exemples valides :
- "Pattern: fondateur SaaS B2B seed — signaux: 10-30 employés, annonce levée <18 mois, CEO LinkedIn actif (posts hebdo) — question-clé: 'tu gères toi-même ta prospection ou tu as un SDR ?'"
- "Pattern: consultant solo senior — signaux: 0-1 employé, 5+ ans activité, offres 1-to-1 — question-clé: 'combien de clients actifs en ce moment ?'"

Ne sont PAS des patterns ICP :
- Règles d'écriture / contraintes de format → appartient à \`hard_rules\` (ex: "max 2 questions", "jamais de bullets")
- Formules à éviter / do-don't de ton → appartient à \`errors\` (ex: "ne pas dire 'j'espère que ça va'")
- Axes de scoring abstraits sans archétype → appartient à \`scoring\` (ex: "priorité séniorité +3")
- Étapes de process → appartient à \`process\` (ex: "d'abord qualifier puis pitcher")
- Un seul signal isolé sans nommage d'archétype (ex: "les gens de 40+ répondent mieux") → extractable:false

À partir du signal fourni, décide :
1. Si le signal décrit (même implicitement) un archétype de prospect avec signaux observables → renvoie un candidat.
2. Sinon → renvoie \`{"extractable": false, "reason": "..."}\`.

Quand tu proposes :
- \`intent\` ∈ {"add_paragraph", "amend_paragraph", "refine_pattern"}
  · add_paragraph = nouveau pattern ICP à ajouter à la taxonomie
  · amend_paragraph = reformulation générale d'un paragraphe existant
  · refine_pattern = affine un pattern existant (ajoute/modifie un signal ou la question-clé)
- \`proposed_text\` : prose descriptive française, ≤ 500 chars, structurée mentalement comme "Pattern: {nom} — signaux: {liste} — question-clé: '{question}'". Concise, prête à être lue dans le doc.
- \`rationale\` : pourquoi, sourcé au signal. Ex: "User a décrit ce profil dans sa correction du draft Marie."
- \`confidence\` : 0.0-1.0, ta certitude que c'est bien un pattern ICP (pas une règle de style ou un signal isolé).

RÈGLES :
- Si le signal est une validation ("ok top", "parfait") → extractable:false.
- Si le signal est une règle d'écriture ou de format (chiffres, interdictions de mots) → extractable:false (va à hard_rules).
- Si le signal nomme ou esquisse un archétype avec au moins 1 signal ET une idée de question-clé → extractable.
- Si l'archétype est implicite (user décrit un profil sans lui donner de nom), propose un nom synthétique mais reste fidèle aux signaux donnés.
- Si ambigu → extractable:false plutôt qu'inventer un pattern.

Réponds UNIQUEMENT en JSON brut (pas de markdown, pas de texte hors JSON).

Format si extractable :
{"intent":"add_paragraph","proposed_text":"...","rationale":"...","confidence":0.85}

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
    target_kind: "icp_patterns",
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
  if (typeof ctx.prospect_snippet === "string" && ctx.prospect_snippet.trim()) {
    lines.push(`Contexte prospect :\n"${ctx.prospect_snippet.slice(0, 600)}"`);
  }
  if (Array.isArray(ctx.entities) && ctx.entities.length) {
    const tags = ctx.entities.filter(e => typeof e === "string").slice(0, 10);
    if (tags.length) lines.push(`Entités matchées : ${tags.join(", ")}`);
  }
  if (typeof ctx.existing_patterns_excerpt === "string" && ctx.existing_patterns_excerpt.trim()) {
    lines.push(`Patterns existants (extrait) :\n${ctx.existing_patterns_excerpt.slice(0, 800)}`);
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
      system: PATTERNS_SYSTEM_PROMPT,
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
 * Extrait une proposition d'icp_pattern à partir d'un signal.
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
export async function extractPattern(signal, opts = {}) {
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
    let result = await callOnce({ anthropic, model, maxTokens, timeoutMs, userMsg });
    let raw = parseJsonFromText(extractText(result));

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

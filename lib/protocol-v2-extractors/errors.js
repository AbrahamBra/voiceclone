// Extractor LLM spécialisé pour la section `errors` (do/don't) du protocole vivant.
//
// Prend un signal (correction, instruction directe, regen_rejection...) et
// propose — si pertinent — un amendement à la section `errors` du doc.
// La conversion du proposed_text en artifact `pairs: [{ avoid, prefer }]` se
// fait à l'accept (Task 4.3). Ici on produit la prose qui décrit la paire.
//
// Contract (Task 2.3 du plan protocole-vivant) :
//   Input  : { source_type, source_text, context }
//   Output : { intent, target_kind: 'errors', proposed_text, rationale, confidence } | null
//
// Null = rien d'extractible comme paire avoid/prefer (le signal peut convenir
// à un autre extracteur — router géré par Task 2.5, pas ici).

import Anthropic from "@anthropic-ai/sdk";
import { parseJsonFromText } from "../claude-helpers.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_SOURCE_TEXT = 4000;
const MAX_PROPOSED_TEXT = 400;
const MIN_PROPOSED_TEXT = 6;

const VALID_INTENTS = new Set(["add_paragraph", "amend_paragraph"]);

export const ERRORS_SYSTEM_PROMPT = `Tu es un extracteur spécialisé pour la section "errors" (do/don't) du protocole opérationnel d'un clone IA LinkedIn.

Cette section contient des PAIRES "avoid → prefer" : des formulations spécifiques que le clone doit arrêter d'utiliser, **avec leur alternative** que le clone doit utiliser à la place. Exemples valides :
- "Évite 'n'hésitez pas à me contacter' — préfère 'dis-moi si ça te parle'"
- "Évite 'parfait' en début de message — préfère rebondir directement sur le fond"
- "Évite 'j'espère que vous allez bien' — préfère une accroche concrète liée au profil"
- "Évite 'cela vous intéresse-t-il ?' — préfère 'tu veux qu'on en parle 15 min ?'"

Ne sont PAS des errors do/don't :
- Conseils de tonalité génériques sans formulation spécifique ("sois plus chaleureux", "sois naturel") → null
- Règles testables programmatiquement ("max 8 lignes", "jamais > 2 questions", "interdit de mentionner le prix") → null, ça appartient à hard_rules
- Patterns ICP ("les fondateurs SaaS répondent mieux") → null
- Étapes process ("d'abord qualifier puis pitcher") → null
- Skeletons de message ("structure : hook + question + CTA") → null

À partir du signal fourni, décide :
1. Si le signal mérite une paire avoid/prefer **explicite** → renvoie un candidat.
2. Sinon → renvoie \`{"extractable": false, "reason": "..."}\`.

Quand tu proposes :
- \`intent\` ∈ {"add_paragraph", "amend_paragraph"}
  · add_paragraph = nouvelle paire avoid/prefer à ajouter
  · amend_paragraph = une paire existante doit être reformulée ou son "prefer" amélioré
- \`proposed_text\` : prose française concise qui contient **explicitement** la formulation à éviter ET sa préférée. Format type : "Évite '...' — préfère '...'.". ≤ 400 chars.
- \`rationale\` : pourquoi, sourcé au signal. Ex: "User a remplacé 'n'hésitez pas' par 'dis-moi' dans la dernière correction."
- \`confidence\` : 0.0-1.0, ta certitude que c'est bien une paire avoid/prefer (pas un conseil de style flou).

RÈGLES :
- Si le signal est une validation ("ok top", "parfait") → extractable:false.
- Si le signal pointe une formulation à éviter SANS proposer d'alternative concrète → extractable:false (paire incomplète).
- Si le signal donne une formulation préférée SANS dire ce qu'elle remplace → tu peux inférer le "avoid" depuis le contexte (last_bot_msg / draft_text) si évident, sinon extractable:false.
- Si le signal est une règle testable (chiffre, jamais X absolu) → extractable:false (route vers hard_rules).
- Si ambigu → extractable:false plutôt qu'inventer.

Réponds UNIQUEMENT en JSON brut (pas de markdown, pas de texte hors JSON).

Format si extractable :
{"intent":"add_paragraph","proposed_text":"Évite '...' — préfère '...'.","rationale":"...","confidence":0.85}

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
    target_kind: "errors",
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
    const tags = ctx.entities.filter((e) => typeof e === "string").slice(0, 10);
    if (tags.length) lines.push(`Entités matchées : ${tags.join(", ")}`);
  }
  if (typeof ctx.existing_pairs_excerpt === "string" && ctx.existing_pairs_excerpt.trim()) {
    lines.push(`Paires avoid/prefer existantes (extrait) :\n${ctx.existing_pairs_excerpt.slice(0, 800)}`);
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
      system: ERRORS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMsg }],
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("extractor_timeout")), timeoutMs),
    ),
  ]);
}

function extractText(result) {
  const block = result?.content?.find?.((b) => b?.type === "text");
  return typeof block?.text === "string" ? block.text : "";
}

/**
 * Extrait une proposition de paire avoid/prefer à partir d'un signal.
 * Retourne null si rien d'extractible, ou en cas d'erreur (timeout, parse fail, etc.).
 *
 * Retry : parse-fail → 1 retry. Les autres erreurs (timeout, réseau) bailent directement.
 *
 * @param {{source_type:string, source_text:string, context?:object}} signal
 * @param {object} [opts]
 * @param {object} [opts.anthropic]
 * @param {string} [opts.apiKey]
 * @param {string} [opts.model]
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<object|null>}
 */
export async function extractError(signal, opts = {}) {
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

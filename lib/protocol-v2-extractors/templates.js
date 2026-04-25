// Extractor LLM spécialisé pour la section `templates` du protocole vivant.
//
// Prend un signal (correction, instruction directe, playbook paste...) et
// propose — si pertinent — un amendement à la section `templates` du doc.
// La conversion du proposed_text en structured JSON ({ skeletons })
// se fait au moment de l'accept (Task 4.3). Ici on produit juste la prose.
//
// Contract (Task 2.4d du plan protocole-vivant) :
//   Input  : { source_type, source_text, context }
//   Output : { intent, target_kind: 'templates', proposed_text, rationale, confidence } | null
//
// Ce qu'on capture :
//   - Skeletons de message par scénario (premier DM, relance, closing, objection)
//     avec leurs slots ordonnés (hook, question, CTA, etc.)
// Ce qu'on NE capture PAS :
//   - Règles d'écriture / de format → hard_rules
//   - Paires do/don't → errors
//   - Patterns ICP → patterns
//   - Étapes process commercial → process

import Anthropic from "@anthropic-ai/sdk";
import { parseJsonFromText } from "../claude-helpers.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_SOURCE_TEXT = 4000;
const MAX_PROPOSED_TEXT = 800;
const MIN_PROPOSED_TEXT = 6;

const VALID_INTENTS = new Set(["add_paragraph", "amend_paragraph"]);

export const TEMPLATES_SYSTEM_PROMPT = `Tu es un extracteur spécialisé pour la section "templates" du protocole opérationnel d'un clone IA LinkedIn.

La section templates contient les SKELETONS DE MESSAGE par scénario. Chaque skeleton :
- Est associé à un scénario nommé (premier DM cold, relance J+3, réponse à objection, closing rdv...)
- A une structure ordonnée de slots (hook, question, CTA, accroche signal, etc.)
- Décrit le contenu attendu de chaque slot, pas la formulation exacte

Exemples valides :
- "Template 'premier DM cold' : slot 1 = mention concrète d'un signal observé sur leur profil ; slot 2 = question ouverte sur leur process actuel ; slot 3 = pas de pitch d'offre ici."
- "Template 'relance J+3' : slot 1 = référer au signal cité au DM1 ; slot 2 = reposer la question principale sans pression ; slot 3 = optionnellement une 2e angle."
- "Template 'objection prix' : slot 1 = reconnaître l'objection ; slot 2 = recadrer sur la valeur métier ; slot 3 = proposer un échange court."
- "Amender 'closing rdv' : ajouter slot 'horaire suggéré' juste avant le CTA."

Ne sont PAS des templates :
- Règles de format atomiques ("max 8 lignes", "jamais > 2 questions") → hard_rules
- Paires "évite X — préfère Y" → errors
- Patterns ICP, profils prospects → patterns
- Étapes process commercial global ("d'abord qualifier puis pitcher") → process
- Axes de scoring → scoring

À partir du signal fourni, décide :
1. Si le signal mérite une proposition de template (skeleton complet OU amendement de slot d'un template existant) → renvoie un candidat.
2. Sinon → renvoie \`{"extractable": false, "reason": "..."}\`.

Quand tu proposes :
- \`intent\` ∈ {"add_paragraph", "amend_paragraph"}
  · add_paragraph = nouveau template à ajouter
  · amend_paragraph = un template existant doit être complété (ajout/refonte d'un slot) ou son scénario reformulé
- \`proposed_text\` : prose française claire (≤ 600 chars).
  · Format type pour add : "Template '<scénario>' : slot 1 = <description> ; slot 2 = <description> ; slot 3 = <description>."
  · Format type pour amend : "Template '<scénario existant>' — modifier slot N : <nouvelle description>." OU "Template '<scénario>' — ajouter slot '<nom>' : <description>."
- \`rationale\` : pourquoi, sourcé au signal.
- \`confidence\` : 0.0-1.0, ta certitude que c'est bien un skeleton (pas une hard_rule, pas un do/don't).

RÈGLES :
- Si le signal décrit une structure de message ("ouverture, hook, question, CTA") → extractable.
- Si le signal nomme un scénario ("template premier DM", "relance", "closing") avec sa structure → extractable.
- Si le signal modifie un slot d'un template existant → extractable, intent=amend_paragraph.
- Si le signal est une règle de format atomique (chiffre, interdit absolu) → extractable:false (hard_rules).
- Si le signal est une paire avoid/prefer sans structure → extractable:false (errors).
- Si le signal décrit un process commercial global, pas un message → extractable:false (process).
- Si ambigu (formulation vague sans scénario nommé ni slots) → extractable:false plutôt qu'inventer.

Réponds UNIQUEMENT en JSON brut (pas de markdown, pas de texte hors JSON).

Format si extractable :
{"intent":"add_paragraph","proposed_text":"...","rationale":"...","confidence":0.85}

Format si non extractable :
{"extractable":false,"reason":"..."}`;

/**
 * Valide + normalise la sortie brute de l'extracteur.
 * Export pur — testable sans API.
 *
 * @param {unknown} raw
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
    target_kind: "templates",
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
  if (typeof ctx.existing_templates_excerpt === "string" && ctx.existing_templates_excerpt.trim()) {
    lines.push(`Templates existants (extrait) :\n${ctx.existing_templates_excerpt.slice(0, 800)}`);
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
      system: TEMPLATES_SYSTEM_PROMPT,
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
 * Extrait une proposition de template à partir d'un signal.
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
export async function extractTemplate(signal, opts = {}) {
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

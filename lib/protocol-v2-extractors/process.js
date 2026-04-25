// Extractor LLM spécialisé pour la section `process` du protocole vivant.
//
// Prend un signal (correction, instruction directe, playbook paste...) et
// propose — si pertinent — un amendement à la section `process` du doc.
// La conversion du proposed_text en structured JSON (steps + transitions)
// se fait au moment de l'accept (Task 4.3). Ici on produit juste la prose.
//
// Contract (Task 2.4c du plan protocole-vivant) :
//   Input  : { source_type, source_text, context }
//   Output : { intent, target_kind: 'process', proposed_text, rationale, confidence } | null
//
// Ce qu'on capture :
//   - Étapes du process commercial avec id, prérequis, actions, outputs
//   - Transitions conditionnelles entre étapes
// Ce qu'on NE capture PAS :
//   - Règles d'écriture / interdictions → hard_rules
//   - Patterns ICP / tonalité → patterns
//   - Axes ou seuils de scoring → scoring
//   - Skeletons de message → templates

import Anthropic from "@anthropic-ai/sdk";
import { parseJsonFromText } from "../claude-helpers.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_SOURCE_TEXT = 4000;
const MAX_PROPOSED_TEXT = 800;
const MIN_PROPOSED_TEXT = 6;

const VALID_INTENTS = new Set(["add_paragraph", "amend_paragraph"]);

export const PROCESS_SYSTEM_PROMPT = `Tu es un extracteur spécialisé pour la section "process" du protocole opérationnel d'un clone IA LinkedIn.

La section process est la STATE MACHINE DU SETTING. Elle décrit l'ordre logique des étapes commerciales et les conditions de passage de l'une à l'autre. Chaque étape a un id, un nom, des prérequis, des actions à mener, et un output qui débloque la suite.

Ce qui appartient à process :
1. ÉTAPES nommées avec leurs prérequis / actions / outputs.
   Exemples valides :
   - "Étape 'qualification' — prérequis: première réponse reçue ; actions: poser au max 2 questions sur leur process actuel ; output: lead scoré 0-3 sur l'axe maturité"
   - "Étape 'pitch' — prérequis: pain point confirmé ET score maturité ≥ 2 ; actions: aligner offre sur leur problème ; output: réaction utilisateur (intéressé / objection / silence)"
   - "Étape 'closing' — prérequis: 2 échanges qualifiants après pitch ; actions: proposer un slot 30 min ; output: rdv calé ou refus explicite"

2. TRANSITIONS conditionnelles : à quelle condition on passe d'une étape à l'autre, ou on revient en arrière.
   Exemples valides :
   - "Ne pas passer à 'pitch' tant que le prospect n'a pas confirmé son pain point"
   - "Si en étape 'closing' le prospect demande un délai > 7 jours → revenir en étape 'qualification'"
   - "Après 'pitch', si 0 réponse à J+5 → passer à 'relance', pas re-pitcher"

Ne sont PAS des éléments de process :
- Règles d'écriture / interdictions de forme ("max 8 lignes", "pas plus de 2 questions") → hard_rules
- Patterns ICP, vocabulaire, tonalité ("les C-levels répondent formel") → patterns
- Axes ou seuils de scoring isolés ("axe urgence 0-3") → scoring (mais OK comme prérequis d'étape)
- Skeletons de message (slots, structure d'un DM) → templates
- Paires avoid/prefer → errors

À partir du signal fourni, décide :
1. Si le signal mérite une proposition process (étape ou transition) → renvoie un candidat.
2. Sinon → renvoie \`{"extractable": false, "reason": "..."}\`.

Quand tu proposes :
- \`intent\` ∈ {"add_paragraph", "amend_paragraph"}
  · add_paragraph = nouvelle étape ou nouvelle transition à ajouter
  · amend_paragraph = une étape ou transition existante doit être reformulée / ses prérequis modifiés
- \`proposed_text\` : prose française claire (≤ 600 chars).
  · Pour une étape : "Étape '<nom>' — prérequis: ... ; actions: ... ; output: ...". Inclure un id mnémotechnique optionnel (ex: 'qualif', 'pitch', 'closing').
  · Pour une transition : "<condition> → <action ou transition vers étape>".
- \`rationale\` : pourquoi, sourcé au signal.
- \`confidence\` : 0.0-1.0, ta certitude que c'est bien du process (pas une hard_rule, pas un template).

RÈGLES :
- Si le signal décrit explicitement un ordre d'actions commerciales (d'abord X, puis Y, jamais Z avant W) → extractable.
- Si le signal mentionne une étape nommée ("phase qualif", "moment du pitch", "relance") → extractable.
- Si le signal est une condition de passage ("ne pitch que si pain point confirmé") → extractable.
- Si le signal est une règle d'écriture (chiffre, format, interdit absolu) → extractable:false (hard_rules).
- Si le signal est un skeleton de message (structure de slots dans un DM) → extractable:false (templates).
- Si ambigu → extractable:false plutôt qu'inventer une étape.

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
    target_kind: "process",
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
  if (typeof ctx.existing_steps_excerpt === "string" && ctx.existing_steps_excerpt.trim()) {
    lines.push(`Étapes/process existants (extrait) :\n${ctx.existing_steps_excerpt.slice(0, 800)}`);
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
      system: PROCESS_SYSTEM_PROMPT,
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
 * Extrait une proposition d'étape/transition process à partir d'un signal.
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
export async function extractProcess(signal, opts = {}) {
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

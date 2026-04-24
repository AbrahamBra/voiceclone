// Extractor LLM spécialisé pour la section `scoring` du protocole vivant.
//
// Prend un signal (correction, instruction directe, playbook paste...) et
// propose — si pertinent — un amendement à la section `scoring` du doc.
// La conversion du proposed_text en structured JSON (axes + decision_table)
// se fait au moment de l'accept (Task 4.3). Ici on produit juste la prose.
//
// Contract (Task 2.4b du plan protocole-vivant) :
//   Input  : { source_type, source_text, context }
//   Output : { intent, target_kind: 'scoring', proposed_text, rationale, confidence } | null
//
// Null = rien d'extractible comme scoring (le signal peut convenir à un
// autre extracteur — router géré par Task 2.5, pas ici).
//
// Ce qu'on capture :
//   - Axes de scoring avec niveaux 0-3 (ex: "urgence perçue" 0=aucun signal,
//     1=vague, 2=deadline, 3=< 30 jours)
//   - Règles de décision fondées sur un score (ex: "score ≥ 7 → DM direct")
// Ce qu'on NE capture PAS :
//   - Règles d'écriture / interdictions → hard_rules
//   - Patterns ICP / tonalité → patterns
//   - Étapes process → process

import Anthropic from "@anthropic-ai/sdk";
import { parseJsonFromText } from "../claude-helpers.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_SOURCE_TEXT = 4000;
const MAX_PROPOSED_TEXT = 800;
const MIN_PROPOSED_TEXT = 4;

const VALID_INTENTS = new Set(["add_paragraph", "amend_paragraph"]);

export const SCORING_SYSTEM_PROMPT = `Tu es un extracteur spécialisé pour la section "scoring" du protocole opérationnel d'un clone IA LinkedIn.

La section scoring est le MOTEUR DE SCORE PROSPECT. Elle contient deux types de contenus :

1. Des AXES DE SCORING (chacun noté 0-3) — un axe = un critère + 4 niveaux explicites.
   Exemples valides :
   - "Axe 'urgence perçue' — 0: aucun signal, 1: vague, 2: mentionne un deadline, 3: délai < 30 jours"
   - "Axe 'maturité offre' — 0: ne sait pas qui il cible, 1: cible vague, 2: ICP clair, 3: ICP + offre packagée"

2. Des RÈGLES DE DÉCISION fondées sur le score (décision table "score → action").
   Exemples valides :
   - "Si score global ≥ 7 → envoyer DM direct sans qualifier"
   - "Si score < 4 sur axe 'budget' → pas de DM offre, rester en nurturing"

Ne sont PAS des éléments de scoring :
- Règles d'écriture / interdictions de forme ("max 8 lignes", "pas de questions") → hard_rules
- Patterns ICP, vocabulaire, tonalité ("les C-levels répondent formel") → patterns
- Étapes d'un process ("d'abord qualifier puis pitcher") → process
- Do/Don't généraux → errors

À partir du signal fourni, décide :
1. Si le signal mérite une proposition scoring → renvoie un candidat.
2. Sinon → renvoie \`{"extractable": false, "reason": "..."}\`.

Quand tu proposes :
- \`intent\` ∈ {"add_paragraph", "amend_paragraph"}
  · add_paragraph = nouvel axe ou nouvelle règle de décision à ajouter
  · amend_paragraph = un axe/règle existant doit être reformulé ou recalibré
- \`proposed_text\` : prose française claire, prête à coller dans la section scoring (≤ 600 chars).
  · Pour un axe : nom entre guillemets + les 4 niveaux numérotés. Ex: "Ajouter l'axe 'urgence perçue' — 0: aucun signal de délai, 1: mention vague d'un besoin, 2: deadline évoquée, 3: délai < 30 jours."
  · Pour une règle : formulation "Si <condition score> → <action>". Ex: "Si score global ≥ 7 → envoyer DM direct sans qualifier."
- \`rationale\` : pourquoi, sourcé au signal.
- \`confidence\` : 0.0-1.0, ta certitude que c'est bien du scoring (pas une hard_rule ou un pattern).

RÈGLES :
- Si le signal mentionne un niveau chiffré (0-3) ou un seuil (≥ N, < N) sur un critère de prospect → extractable, confidence élevée.
- Si le signal propose un nouvel axe avec ses niveaux → extractable, intent=add_paragraph.
- Si le signal recalibre un niveau existant ("en fait 3 c'est plutôt < 15 jours") → amend_paragraph.
- Si le signal est une règle d'écriture ("max N questions", "jamais X") → extractable:false (hard_rules).
- Si le signal est un simple pattern ICP ou conseil de ton → extractable:false.
- Si ambigu → extractable:false plutôt qu'inventer un axe.

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
    target_kind: "scoring",
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
  if (typeof ctx.existing_scoring_excerpt === "string" && ctx.existing_scoring_excerpt.trim()) {
    lines.push(`Section scoring existante (extrait) :\n${ctx.existing_scoring_excerpt.slice(0, 800)}`);
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
      system: SCORING_SYSTEM_PROMPT,
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
 * Extrait une proposition de scoring à partir d'un signal.
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
export async function extractScoring(signal, opts = {}) {
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

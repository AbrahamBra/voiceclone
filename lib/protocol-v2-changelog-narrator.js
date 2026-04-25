/**
 * lib/protocol-v2-changelog-narrator.js
 *
 * Génère le récit narratif d'un publish event — Sudowrite-style.
 *
 * Le ton à reproduire (calibré sur https://feedback.sudowrite.com/changelog) :
 *   - registre opérationnel, pas marketing
 *   - on raconte ce qui a été APPRIS, pas ce qui a été codé
 *   - on cite les exemples concrets (pas de "améliore la cohérence générale")
 *   - on assume les retraits ("on a viré X parce que Y")
 *
 * Sortie : { narrative, brief }
 *   - narrative : 150-250 mots, pour la page changelog complète
 *   - brief : ≤ 30 mots, pour les UIs compactes (liste, tooltip, notif)
 */

import { callClaudeWithTimeout, parseJsonFromText } from "./claude-helpers.js";

const NARRATOR_MODEL = "claude-haiku-4-5-20251001";
const NARRATOR_MAX_TOKENS = 800;
const NARRATOR_TIMEOUT_MS = 12_000;

/**
 * Compose the system + user prompt for the narrator.
 *
 * Pure function — exported for tests.
 *
 * @param {object} args
 * @param {Array<{intent:string, target_kind:string, proposed_text:string, rationale?:string}>} args.accepted
 * @param {Array<{intent:string, target_kind:string, proposed_text:string}>} args.rejected
 * @param {Array<{intent:string, target_kind:string, proposed_text:string, user_note?:string}>} args.revised
 * @param {string} [args.personaName]
 * @param {number} [args.fromVersion]
 * @param {number} [args.toVersion]
 * @returns {{system:string, user:string}}
 */
export function composeNarratorPrompt({
  accepted = [],
  rejected = [],
  revised = [],
  personaName = "le clone",
  fromVersion,
  toVersion,
}) {
  const versionLine =
    fromVersion && toVersion
      ? `Passage v${fromVersion} → v${toVersion}.`
      : "Nouveau publish du protocole.";

  const system = `Tu écris le changelog d'un protocole opérationnel pour un agent ghostwriter d'agence LinkedIn.

Le ton à respecter, calibré sur le changelog public de Sudowrite :
- registre opérationnel, JAMAIS marketing ("améliore la cohérence", "optimise l'expérience" → INTERDIT)
- on raconte ce qui a été APPRIS du terrain, pas ce qui a été "ajouté"
- on cite les exemples concrets quand il y en a (la règle elle-même, en français)
- on assume les retraits ("on a viré X parce que Y")
- registre humain, pas notice technique

Tu écris en français. Tu écris pour un setter ou un client d'agence — pas pour un dev.

Sortie OBLIGATOIRE en JSON pur, deux champs :
  {"narrative": "...", "brief": "..."}

- narrative : 150-250 mots. Trois ou quatre paragraphes courts. Cite 2-3 changements clés.
- brief : 30 mots maximum. Une phrase d'accroche pour la liste/notification.

Exemples du ton attendu (à imiter, ne pas copier) :
  "Cette semaine, ${personaName} a appris à ne pas alterner vouvoiement et tutoiement dans la même conversation — on s'aligne sur le client. On a aussi viré la formule 'à votre disposition' parce qu'aucun prospect ne réagit dessus."
  "Trois nouvelles règles sur la qualification des leads tièdes : prérequis, signaux à capter, angles de relance. Et on a précisé que 'visio' devient 'visioconférence', plus naturel à l'oral."`;

  const sections = [];

  if (accepted.length > 0) {
    sections.push(
      `### Propositions intégrées (${accepted.length})\n` +
        accepted
          .map(
            (p, i) =>
              `${i + 1}. [${p.intent} → ${p.target_kind}] ${p.proposed_text}` +
              (p.rationale ? `\n   raison: ${p.rationale}` : ""),
          )
          .join("\n"),
    );
  }

  if (revised.length > 0) {
    sections.push(
      `### Propositions intégrées en version reformulée (${revised.length})\n` +
        revised
          .map(
            (p, i) =>
              `${i + 1}. [${p.intent} → ${p.target_kind}] ${p.proposed_text}` +
              (p.user_note ? `\n   note humaine: ${p.user_note}` : ""),
          )
          .join("\n"),
    );
  }

  if (rejected.length > 0) {
    sections.push(
      `### Propositions refusées (${rejected.length})\n` +
        rejected
          .map((p, i) => `${i + 1}. [${p.intent} → ${p.target_kind}] ${p.proposed_text}`)
          .join("\n"),
    );
  }

  const user =
    `${versionLine}\n\n` +
    (sections.length > 0
      ? sections.join("\n\n")
      : "Aucune proposition résolue dans ce publish (republish ou first version).") +
    `\n\nGénère le changelog narratif en JSON pur, deux champs (narrative, brief). Pas d'autre texte hors du JSON.`;

  return { system, user };
}

/**
 * Generate the narrative + brief by calling Anthropic.
 *
 * @param {object} args
 * @param {object} [args.client] - optional auth client (for getApiKey lookup)
 * @param {Array} args.accepted
 * @param {Array} args.rejected
 * @param {Array} args.revised
 * @param {string} [args.personaName]
 * @param {number} [args.fromVersion]
 * @param {number} [args.toVersion]
 * @param {function} [args.callClaude] - injected for tests
 * @returns {Promise<{narrative:string|null, brief:string|null, error?:string}>}
 */
export async function generateNarrative({
  client,
  accepted,
  rejected,
  revised,
  personaName,
  fromVersion,
  toVersion,
  callClaude = callClaudeWithTimeout,
}) {
  const { system, user } = composeNarratorPrompt({
    accepted,
    rejected,
    revised,
    personaName,
    fromVersion,
    toVersion,
  });

  let response;
  try {
    response = await callClaude({
      client,
      model: NARRATOR_MODEL,
      max_tokens: NARRATOR_MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
      timeoutMs: NARRATOR_TIMEOUT_MS,
      timeoutLabel: "narrator_timeout",
    });
  } catch (err) {
    return { narrative: null, brief: null, error: err.message || "narrator_call_failed" };
  }

  const text = response?.content?.[0]?.text;
  if (!text) return { narrative: null, brief: null, error: "narrator_empty_response" };

  const parsed = parseJsonFromText(text);
  if (!parsed || typeof parsed !== "object") {
    return { narrative: null, brief: null, error: "narrator_unparseable" };
  }

  const narrative = typeof parsed.narrative === "string" ? parsed.narrative.trim() : null;
  const brief = typeof parsed.brief === "string" ? parsed.brief.trim() : null;

  if (!narrative && !brief) {
    return { narrative: null, brief: null, error: "narrator_missing_fields" };
  }

  return { narrative, brief };
}

export const NARRATOR_DEFAULTS = Object.freeze({
  MODEL: NARRATOR_MODEL,
  MAX_TOKENS: NARRATOR_MAX_TOKENS,
  TIMEOUT_MS: NARRATOR_TIMEOUT_MS,
});

// Canonical scenarios — source of truth on the frontend.
// MUST stay in lockstep with the scenario_canonical Postgres enum defined in
// supabase/025_sprint0_foundation.sql. When you add/remove/rename a scenario,
// update both files together.
//
// Dual-write period (Sprint 0.b additive rollout) :
//   - conversations.scenario       (text, legacy)   → still written for back-compat
//   - conversations.scenario_type  (enum, new)      → written when a canonical is chosen
// Consumers that need the full persona-specific config still look up
// persona.scenarios[legacyKeyFor(id)] because persona.scenarios jsonb is
// intentionally NOT restructured in Sprint 0.

/**
 * @typedef {'post_autonome' | 'post_lead_magnet' | 'post_actu'
 *   | 'post_prise_position' | 'post_framework' | 'post_cas_client'
 *   | 'post_coulisse'
 *   | 'DM_1st' | 'DM_relance' | 'DM_reply' | 'DM_closing'} ScenarioId
 *
 * @typedef {'post' | 'dm'} ScenarioKind
 *
 * @typedef {Object} ScenarioDef
 * @property {ScenarioId} id
 * @property {ScenarioKind} kind
 * @property {string} label       Short label for UI dropdowns
 * @property {string} description Operator-facing explanation
 * @property {'post' | 'dm'} legacyKey  persona.scenarios jsonb key (pre-migration)
 */

/** @type {Readonly<Record<ScenarioId, ScenarioDef>>} */
export const CANONICAL_SCENARIOS = Object.freeze({
  post_autonome: {
    id: "post_autonome",
    kind: "post",
    label: "Post autonome",
    description: "Contenu standalone, pas de CTA fort",
    legacyKey: "post",
  },
  post_lead_magnet: {
    id: "post_lead_magnet",
    kind: "post",
    label: "Post lead magnet",
    description: "Orienté conversion, CTA obligatoire",
    legacyKey: "post",
  },
  post_actu: {
    id: "post_actu",
    kind: "post",
    label: "Post actualité croisée",
    description: "Prise sur actu récente avec angle perso",
    legacyKey: "post",
  },
  post_prise_position: {
    id: "post_prise_position",
    kind: "post",
    label: "Post prise de position",
    description: "Opinion tranchée, controverse assumée",
    legacyKey: "post",
  },
  post_framework: {
    id: "post_framework",
    kind: "post",
    label: "Post framework",
    description: "Méthode / checklist / liste actionnable",
    legacyKey: "post",
  },
  post_cas_client: {
    id: "post_cas_client",
    kind: "post",
    label: "Post cas client",
    description: "Résultat concret, narration avant/après",
    legacyKey: "post",
  },
  post_coulisse: {
    id: "post_coulisse",
    kind: "post",
    label: "Post coulisse",
    description: "Transparence, storytelling interne",
    legacyKey: "post",
  },
  DM_1st: {
    id: "DM_1st",
    kind: "dm",
    label: "DM — 1er message",
    description: "Cold approach, accroche initiale",
    legacyKey: "dm",
  },
  DM_relance: {
    id: "DM_relance",
    kind: "dm",
    label: "DM — Relance",
    description: "Follow-up après silence",
    legacyKey: "dm",
  },
  DM_reply: {
    id: "DM_reply",
    kind: "dm",
    label: "DM — Réponse chaude",
    description: "Reply à un prospect engagé",
    legacyKey: "dm",
  },
  DM_closing: {
    id: "DM_closing",
    kind: "dm",
    label: "DM — Closing",
    description: "Booking RDV / appel",
    legacyKey: "dm",
  },
});

/** @type {readonly ScenarioId[]} */
export const SCENARIO_IDS = Object.freeze(
  /** @type {ScenarioId[]} */ (Object.keys(CANONICAL_SCENARIOS))
);

/**
 * @param {unknown} value
 * @returns {value is ScenarioId}
 */
export function isScenarioId(value) {
  return typeof value === "string" && value in CANONICAL_SCENARIOS;
}

/**
 * Canonical → legacy jsonb key (for persona.scenarios lookup during dual-write).
 * @param {ScenarioId} id
 */
export function legacyKeyFor(id) {
  return CANONICAL_SCENARIOS[id].legacyKey;
}

/**
 * Which canonical scenarios does this persona support ?
 * Uses personas.type as the primary signal (values per migration 008 :
 * 'posts' | 'dm' | 'both'). Falls back to legacy scenarios jsonb keys.
 *
 * @param {{ type?: string | null, scenarios?: Record<string, unknown> | null }} persona
 * @returns {ScenarioId[]}
 */
export function supportedCanonicalScenarios(persona) {
  const type = persona.type;
  if (type === "posts") return filterByKind("post");
  if (type === "dm") return filterByKind("dm");
  if (type === "both") return [...SCENARIO_IDS];

  // Legacy fallback (only hit when the backend forgot to include type,
  // or for a persona predating migration 008). We derive support strictly
  // from explicit jsonb keys. "default" is NOT treated as evidence of
  // post-support — DM-only personas almost always carry a "default" entry
  // too, which used to mis-classify them as post-supporting.
  const keys = new Set(Object.keys(persona.scenarios ?? {}));
  const supportsPost = keys.has("post");
  const supportsDm = keys.has("dm") || keys.has("qualification");
  if (!supportsPost && !supportsDm) {
    // Only ambiguous keys (e.g. just { default }) — show everything and
    // let the user pick rather than silently hide canonical scenarios.
    return keys.size > 0 ? [...SCENARIO_IDS] : [];
  }
  return SCENARIO_IDS.filter((id) => {
    const kind = CANONICAL_SCENARIOS[id].kind;
    return (kind === "post" && supportsPost) || (kind === "dm" && supportsDm);
  });
}

/**
 * @param {ScenarioKind} kind
 * @returns {ScenarioId[]}
 */
function filterByKind(kind) {
  return SCENARIO_IDS.filter((id) => CANONICAL_SCENARIOS[id].kind === kind);
}

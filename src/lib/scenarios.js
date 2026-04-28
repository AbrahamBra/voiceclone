// Canonical scenarios — source of truth on the frontend.
// MUST stay in lockstep with the scenario_canonical Postgres enum defined in
// supabase/025_sprint0_foundation.sql. When you add/remove/rename a scenario,
// update both files together.
//
// DM-only since 2026-04-28 — post mode removed from the app (scraping of
// LinkedIn posts as INPUT data is unaffected, see api/scrape.js).

/**
 * @typedef {'DM_1st' | 'DM_relance' | 'DM_reply' | 'DM_closing'} ScenarioId
 *
 * @typedef {Object} ScenarioStarter
 * @property {string} label     Short chip label shown above the composer
 * @property {string} template  Text pre-filled into the composer textarea on click
 *
 * @typedef {Object} ScenarioDef
 * @property {ScenarioId} id
 * @property {string} label       Short label for UI dropdowns
 * @property {string} description Operator-facing explanation
 * @property {ScenarioStarter[]} [starters]  Optional pilot-only chip starters
 */

// Named CANONICAL_SCENARIOS (not SCENARIOS) to avoid collision with the
// unrelated landing-demo SCENARIOS array in $lib/landing-demo.js.
/** @type {Readonly<Record<ScenarioId, ScenarioDef>>} */
export const CANONICAL_SCENARIOS = Object.freeze({
  DM_1st: {
    id: "DM_1st",
    label: "DM — 1er message",
    description: "Cold approach, accroche initiale",
  },
  DM_relance: {
    id: "DM_relance",
    label: "DM — Relance",
    description: "Follow-up après silence",
  },
  DM_reply: {
    id: "DM_reply",
    label: "DM — Réponse chaude",
    description: "Reply à un prospect engagé",
  },
  DM_closing: {
    id: "DM_closing",
    label: "DM — Closing",
    description: "Booking RDV / appel",
  },
});

/** @type {readonly ScenarioId[]} */
export const SCENARIO_IDS = Object.freeze(
  /** @type {ScenarioId[]} */ (Object.keys(CANONICAL_SCENARIOS))
);

export const DEFAULT_SCENARIO_ID = "DM_1st";

/**
 * @param {unknown} value
 * @returns {value is ScenarioId}
 */
export function isScenarioId(value) {
  return typeof value === "string" && value in CANONICAL_SCENARIOS;
}

/**
 * Canonical → legacy jsonb key. DM-only app: always "dm".
 * Kept as a function so callers don't need to change.
 * @param {ScenarioId} _id
 */
export function legacyKeyFor(_id) {
  return "dm";
}

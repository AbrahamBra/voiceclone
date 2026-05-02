import { writable } from "svelte/store";

export const messages = writable([]);
export const currentConversationId = writable(null);
export const conversations = writable([]);
// Legacy free-text scenario tied to persona.scenarios jsonb keys.
// DM-only app: only "dm", "qualification", "default" are still meaningful.
export const currentScenario = writable("");
// Canonical ScenarioId from src/lib/scenarios.js (DM_1st / DM_reply /
// DM_relance / DM_closing). Default DM_1st is set on page load when no
// scenario_type is provided in the URL.
/** @type {import("svelte/store").Writable<string | null>} */
export const currentScenarioType = writable(null);
// Migration 055 — source_core (lead origin), orthogonal to scenario_type.
// One of the 6 core categories from $lib/source-core.js, or null when not set.
// When non-null, the chat backend merges in the persona's source-specific
// playbook artifacts on top of the global protocol doc.
/** @type {import("svelte/store").Writable<string | null>} */
export const currentSourceCore = writable(null);
// V1.0 PlaybookContextPanel — toggle sélectionné manuellement par le setter
// dans la mini-timeline du panneau playbook. Reset à null au changement de
// conversation (le panneau retombe sur le default dérivé du scenario_type).
// Non persisté en DB en V1.0.
/** @type {import("svelte/store").Writable<number | null>} */
export const currentToggleOverride = writable(null);
export const sending = writable(false);

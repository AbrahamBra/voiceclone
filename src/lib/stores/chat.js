import { writable } from "svelte/store";

export const messages = writable([]);
export const currentConversationId = writable(null);
export const conversations = writable([]);
// Legacy free-text scenario tied to persona.scenarios jsonb keys
// (values like "post", "dm", "qualification", "default").
export const currentScenario = writable("");
// Canonical ScenarioId from src/lib/scenarios.js — Sprint 0.b additive.
// null when nothing has been picked yet (e.g. legacy deep link without
// scenario_type). Set by ScenarioSwitcher.
/** @type {import("svelte/store").Writable<string | null>} */
export const currentScenarioType = writable(null);
export const sending = writable(false);

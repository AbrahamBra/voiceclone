import { isScenarioId } from "$lib/scenarios.js";

export function load({ params, url }) {
  const rawScenarioType = url.searchParams.get("scenario_type");
  const scenarioType = isScenarioId(rawScenarioType) ? rawScenarioType : null;
  return {
    personaId: params.persona,
    // Legacy query param kept for back-compat with existing hub links,
    // deep links and bookmarks. Defaults to "default" (which the backend
    // maps to the persona's fallback scenario file).
    scenario: url.searchParams.get("scenario") || "default",
    // Canonical enum value (Sprint 0.b). null when no canonical was picked.
    // When both are present, backend prefers scenario_type for the new
    // conversations.scenario_type column; legacy scenario is still written
    // to conversations.scenario for dual-write safety.
    scenarioType,
  };
}

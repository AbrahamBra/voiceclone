import { DEFAULT_SCENARIO_ID, isScenarioId } from "$lib/scenarios.js";
import { isSourceCoreId } from "$lib/source-core.js";

export function load({ params, url }) {
  const rawScenarioType = url.searchParams.get("scenario_type");
  // DM-only app: when no canonical scenario is provided in the URL we land
  // on DM_1st by default — the composer's scenario-gate would otherwise
  // stay locked and block the operator on cold-start.
  const scenarioType = isScenarioId(rawScenarioType) ? rawScenarioType : DEFAULT_SCENARIO_ID;
  // Migration 055 — source_core (lead origin) read from URL. NULL by default,
  // operator picks via the SourceCorePicker once on the chat page (or arrives
  // pre-filled via a hub link like ?source_core=visite_profil).
  const rawSourceCore = url.searchParams.get("source_core");
  const sourceCore = isSourceCoreId(rawSourceCore) ? rawSourceCore : null;
  return {
    personaId: params.persona,
    // Legacy query param kept for back-compat with existing hub links,
    // deep links and bookmarks.
    scenario: url.searchParams.get("scenario") || "dm",
    scenarioType,
    sourceCore,
  };
}

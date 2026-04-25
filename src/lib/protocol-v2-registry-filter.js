// Pure helpers for ProtocolRegistry filtering + searching.
// Extracted from the component so we can unit-test without mounting Svelte.

/**
 * Flatten a list of sections into one row per artifact (with section info merged).
 *
 * @param {Array<{id:string, kind:string, heading:string|null, artifacts?: Array<object>}>} sections
 * @returns {Array<{
 *   artifact_id: string,
 *   section_id: string,
 *   section_kind: string,
 *   section_heading: string|null,
 *   kind: string,
 *   severity: string|null,
 *   content: object,
 *   source_quote: string|null,
 *   scenarios: string[]|null,
 *   stats: object,
 *   is_active: boolean,
 * }>}
 */
export function flattenArtifacts(sections) {
  const rows = [];
  for (const section of sections || []) {
    const artifacts = Array.isArray(section?.artifacts) ? section.artifacts : [];
    for (const a of artifacts) {
      if (!a) continue;
      rows.push({
        artifact_id: a.id,
        section_id: section.id,
        section_kind: section.kind,
        section_heading: section.heading || null,
        kind: a.kind,
        severity: a.severity || null,
        content: a.content || {},
        source_quote: a.source_quote || null,
        scenarios: Array.isArray(a.scenarios) ? a.scenarios : null,
        stats: a.stats || { fires: 0, last_fired_at: null, accuracy: null },
        is_active: a.is_active !== false,
      });
    }
  }
  return rows;
}

/**
 * Apply filters and a free-text query to a flat list of artifact rows.
 *
 * @param {Array<object>} rows - Output of flattenArtifacts.
 * @param {object} filters
 * @param {string[]} [filters.kinds]      - Inclusive filter on artifact kind.
 * @param {string[]} [filters.severities] - Inclusive filter on severity.
 * @param {string} [filters.scenario]     - Substring match on any scenario.
 * @param {string} [filters.sectionKind]  - Exact match on section_kind.
 * @param {string} [filters.query]        - Free-text on quote / content / scenarios.
 * @param {boolean} [filters.activeOnly=true]
 * @returns {Array<object>}
 */
export function filterArtifacts(rows, filters = {}) {
  const {
    kinds = null,
    severities = null,
    scenario = "",
    sectionKind = "",
    query = "",
    activeOnly = true,
  } = filters;

  const kindSet = Array.isArray(kinds) && kinds.length ? new Set(kinds) : null;
  const sevSet = Array.isArray(severities) && severities.length ? new Set(severities) : null;
  const scenarioLc = scenario.trim().toLowerCase();
  const queryLc = query.trim().toLowerCase();

  return (rows || []).filter((r) => {
    if (!r) return false;
    if (activeOnly && r.is_active === false) return false;
    if (kindSet && !kindSet.has(r.kind)) return false;
    if (sevSet && !sevSet.has(r.severity || "")) return false;
    if (sectionKind && r.section_kind !== sectionKind) return false;

    if (scenarioLc) {
      const list = r.scenarios || [];
      const hit = list.some((s) => typeof s === "string" && s.toLowerCase().includes(scenarioLc));
      if (!hit) return false;
    }

    if (queryLc) {
      const haystack = [
        r.source_quote || "",
        JSON.stringify(r.content || {}),
        (r.scenarios || []).join(" "),
        r.section_heading || "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(queryLc)) return false;
    }

    return true;
  });
}

/**
 * Sort rows by (last_fired_at DESC, fires DESC, severity DESC by hard>strong>light).
 * Provides a stable, useful default for the registry view.
 */
export function sortArtifactsForRegistry(rows) {
  const sevWeight = (s) => (s === "hard" ? 3 : s === "strong" ? 2 : s === "light" ? 1 : 0);
  return [...rows].sort((a, b) => {
    const la = a.stats?.last_fired_at ? new Date(a.stats.last_fired_at).getTime() : 0;
    const lb = b.stats?.last_fired_at ? new Date(b.stats.last_fired_at).getTime() : 0;
    if (lb !== la) return lb - la;
    const fa = a.stats?.fires ?? 0;
    const fb = b.stats?.fires ?? 0;
    if (fb !== fa) return fb - fa;
    return sevWeight(b.severity) - sevWeight(a.severity);
  });
}

/**
 * Aggregate kind / severity / sectionKind values that appear in the rows.
 * Used to populate filter dropdowns dynamically.
 */
export function collectFilterOptions(rows) {
  const kinds = new Set();
  const severities = new Set();
  const sectionKinds = new Set();
  for (const r of rows || []) {
    if (r?.kind) kinds.add(r.kind);
    if (r?.severity) severities.add(r.severity);
    if (r?.section_kind) sectionKinds.add(r.section_kind);
  }
  return {
    kinds: Array.from(kinds).sort(),
    severities: Array.from(severities).sort(),
    sectionKinds: Array.from(sectionKinds).sort(),
  };
}

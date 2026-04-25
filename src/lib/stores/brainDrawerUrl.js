// Pure URL helpers for the brain drawer tab query param.
// No SvelteKit imports — unit-testable in node:test.

/**
 * Read the brain tab from search params, with fallback.
 * @param {URLSearchParams} searchParams
 * @param {string[]} validTabs
 * @param {string} defaultTab
 * @returns {string|null} — the tab name, defaultTab if present-but-invalid, or null if absent.
 */
export function parseBrainTab(searchParams, validTabs, defaultTab) {
  if (!searchParams.has('brain')) return null;
  const raw = searchParams.get('brain');
  if (!raw) return defaultTab;  // present-but-empty counts as "tried to open, no tab" → default
  return validTabs.includes(raw) ? raw : defaultTab;
}

/**
 * Build a new URL with the brain tab param set or removed. Does not mutate input.
 * @param {URL} url
 * @param {string|null} tab — null to remove the param.
 * @returns {URL}
 */
export function buildUrlWithBrain(url, tab) {
  const next = new URL(url);
  if (tab) next.searchParams.set('brain', tab);
  else next.searchParams.delete('brain');
  return next;
}

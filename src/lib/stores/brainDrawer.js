// Thin SvelteKit wrapper over brainDrawerCore. Provides the store instance
// used by components. Not unit-tested — covered by manual smoke (spec §acceptance criteria #3, #4, #11).
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { get } from 'svelte/store';
import { createBrainDrawerCore } from './brainDrawerCore.js';
import { buildUrlWithBrain } from './brainDrawerUrl.js';

export const VALID_BRAIN_TABS = ['connaissance', 'protocole', 'intelligence', 'reglages'];
const DEFAULT_TAB = 'connaissance';

// SSR-safe storage shim. On the server, getItem returns null and setItem is a no-op.
const storage = {
  getItem: (k) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null),
  setItem: (k, v) => { if (typeof localStorage !== 'undefined') localStorage.setItem(k, v); },
};

function onTabChange(tab, opts = {}) {
  if (typeof window === 'undefined') return;  // SSR: skip nav
  const current = get(page);
  const url = buildUrlWithBrain(current.url, tab);
  goto(url, { replaceState: opts.replaceState ?? false, noScroll: true, keepFocus: true });
}

export const brainDrawer = createBrainDrawerCore({
  storage,
  validTabs: VALID_BRAIN_TABS,
  defaultTab: DEFAULT_TAB,
  onTabChange,
});

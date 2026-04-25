// Pure state machine for the brain drawer. No SvelteKit imports.
// URL/storage side-effects injected via the factory.
import { writable, get } from 'svelte/store';

export const STORAGE_KEY = 'brainDrawer:lastTab';

/**
 * @param {object} opts
 * @param {{getItem: (k: string) => string|null, setItem: (k: string, v: string) => void}} opts.storage
 * @param {string[]} opts.validTabs
 * @param {string} opts.defaultTab
 * @param {(tab: string|null, opts?: {replaceState?: boolean}) => void} opts.onTabChange — called with the tab (or null on close) + options; the thin wrapper uses this to drive goto().
 */
export function createBrainDrawerCore({ storage, validTabs, defaultTab, onTabChange }) {
  const { subscribe, set, update } = writable({ open: false, tab: defaultTab });

  function lastTab() {
    const stored = storage.getItem(STORAGE_KEY);
    return validTabs.includes(stored) ? stored : defaultTab;
  }

  function remember(tab) {
    if (validTabs.includes(tab)) storage.setItem(STORAGE_KEY, tab);
  }

  function open(tab) {
    const t = validTabs.includes(tab) ? tab : lastTab();
    remember(t);
    onTabChange(t, { replaceState: false });
    set({ open: true, tab: t });
  }

  function openAt(tab) {
    return open(tab);
  }

  function close() {
    onTabChange(null, { replaceState: false });
    update(s => ({ ...s, open: false }));
  }

  function toggle() {
    const s = get({ subscribe });
    if (s.open) {
      close();
      return;
    }
    const t = validTabs.includes(s.tab) ? s.tab : lastTab();
    remember(t);
    onTabChange(t, { replaceState: false });
    set({ open: true, tab: t });
  }

  function setTab(tab) {
    if (!validTabs.includes(tab)) return;
    remember(tab);
    onTabChange(tab, { replaceState: true });
    update(s => ({ ...s, tab }));
  }

  // Called by the thin wrapper on URL changes. URL is source of truth — no echo
  // back via onTabChange to avoid a reactive loop.
  function syncFromUrl(urlTab) {
    if (urlTab && validTabs.includes(urlTab)) {
      remember(urlTab);
      set({ open: true, tab: urlTab });
    } else {
      update(s => ({ ...s, open: false }));
    }
  }

  return { subscribe, open, openAt, close, toggle, setTab, syncFromUrl };
}

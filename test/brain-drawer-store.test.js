import { strict as assert } from "node:assert";
import { describe, it, beforeEach } from "node:test";
import { get } from "svelte/store";
import { createBrainDrawerCore } from "../src/lib/stores/brainDrawerCore.js";

const VALID = ['connaissance', 'protocole', 'intelligence', 'reglages'];
const DEFAULT = 'connaissance';

function makeFakeStorage() {
  let store = {};
  return {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    _dump: () => ({ ...store }),
    _load: (obj) => { store = { ...obj }; },
  };
}

function makeRecorder() {
  const calls = [];
  const fn = (tab, opts) => calls.push({ tab, opts: opts || {} });
  return { fn, calls };
}

function makeCore({ storage, onTabChange, initialStorage = {} } = {}) {
  const s = storage || makeFakeStorage();
  s._load?.(initialStorage);
  const rec = onTabChange || makeRecorder();
  const core = createBrainDrawerCore({
    storage: s,
    validTabs: VALID,
    defaultTab: DEFAULT,
    onTabChange: rec.fn,
  });
  return { core, storage: s, onTabChange: rec };
}

describe("brainDrawerCore — initial state", () => {
  it("starts closed on default tab", () => {
    const { core } = makeCore();
    const state = get(core);
    assert.equal(state.open, false);
    assert.equal(state.tab, DEFAULT);
  });
});

describe("brainDrawerCore — open()", () => {
  it("open() with no arg uses lastTab from storage", () => {
    const { core } = makeCore({ initialStorage: { 'brainDrawer:lastTab': 'intelligence' } });
    core.open();
    const state = get(core);
    assert.equal(state.open, true);
    assert.equal(state.tab, 'intelligence');
  });

  it("open() with no arg and empty storage falls back to default", () => {
    const { core } = makeCore();
    core.open();
    assert.equal(get(core).tab, DEFAULT);
  });

  it("open('protocole') opens on that tab", () => {
    const { core, storage } = makeCore();
    core.open('protocole');
    assert.equal(get(core).tab, 'protocole');
    assert.equal(storage.getItem('brainDrawer:lastTab'), 'protocole');
  });

  it("open('invalid') falls back to lastTab", () => {
    const { core } = makeCore({ initialStorage: { 'brainDrawer:lastTab': 'reglages' } });
    core.open('invalid');
    assert.equal(get(core).tab, 'reglages');
  });

  it("open() emits onTabChange(tab, {replaceState: false})", () => {
    const { core, onTabChange } = makeCore();
    core.open('protocole');
    assert.equal(onTabChange.calls.length, 1);
    assert.equal(onTabChange.calls[0].tab, 'protocole');
    assert.equal(onTabChange.calls[0].opts.replaceState, false);
  });
});

describe("brainDrawerCore — openAt()", () => {
  it("openAt(tab) is a synonym of open(tab)", () => {
    const { core } = makeCore();
    core.openAt('reglages');
    assert.equal(get(core).open, true);
    assert.equal(get(core).tab, 'reglages');
  });
});

describe("brainDrawerCore — close()", () => {
  it("close() sets open=false but preserves tab", () => {
    const { core } = makeCore();
    core.open('protocole');
    core.close();
    const state = get(core);
    assert.equal(state.open, false);
    assert.equal(state.tab, 'protocole');
  });

  it("close() emits onTabChange(null, {replaceState: false})", () => {
    const { core, onTabChange } = makeCore();
    core.open('protocole');
    onTabChange.calls.length = 0;
    core.close();
    assert.equal(onTabChange.calls.length, 1);
    assert.equal(onTabChange.calls[0].tab, null);
    assert.equal(onTabChange.calls[0].opts.replaceState, false);
  });
});

describe("brainDrawerCore — toggle()", () => {
  it("toggle() from closed opens on current tab", () => {
    const { core } = makeCore({ initialStorage: { 'brainDrawer:lastTab': 'intelligence' } });
    core.setTab('protocole'); // state.tab is 'protocole' but drawer closed
    core.toggle();
    assert.equal(get(core).open, true);
    assert.equal(get(core).tab, 'protocole');
  });

  it("toggle() from open closes", () => {
    const { core } = makeCore();
    core.open('reglages');
    core.toggle();
    assert.equal(get(core).open, false);
    assert.equal(get(core).tab, 'reglages');
  });

  it("toggle() fresh session (no setTab yet) falls back to default", () => {
    const { core } = makeCore();
    core.toggle();
    assert.equal(get(core).open, true);
    assert.equal(get(core).tab, DEFAULT);
  });
});

describe("brainDrawerCore — setTab()", () => {
  it("setTab(valid) updates tab AND persists to storage", () => {
    const { core, storage } = makeCore();
    core.open();
    core.setTab('intelligence');
    assert.equal(get(core).tab, 'intelligence');
    assert.equal(storage.getItem('brainDrawer:lastTab'), 'intelligence');
  });

  it("setTab(invalid) is a no-op", () => {
    const { core } = makeCore();
    core.open('protocole');
    core.setTab('invented');
    assert.equal(get(core).tab, 'protocole');
  });

  it("setTab emits onTabChange(tab, {replaceState: true})", () => {
    const { core, onTabChange } = makeCore();
    core.open('protocole');
    onTabChange.calls.length = 0;
    core.setTab('intelligence');
    assert.equal(onTabChange.calls.length, 1);
    assert.equal(onTabChange.calls[0].tab, 'intelligence');
    assert.equal(onTabChange.calls[0].opts.replaceState, true);
  });
});

describe("brainDrawerCore — syncFromUrl()", () => {
  it("syncFromUrl('protocole') opens on that tab", () => {
    const { core } = makeCore();
    core.syncFromUrl('protocole');
    assert.equal(get(core).open, true);
    assert.equal(get(core).tab, 'protocole');
  });

  it("syncFromUrl(null) closes the drawer", () => {
    const { core } = makeCore();
    core.open('protocole');
    core.syncFromUrl(null);
    assert.equal(get(core).open, false);
  });

  it("syncFromUrl persists the tab to storage (lastTab)", () => {
    const { core, storage } = makeCore();
    core.syncFromUrl('intelligence');
    assert.equal(storage.getItem('brainDrawer:lastTab'), 'intelligence');
  });

  it("syncFromUrl does NOT emit onTabChange (URL is source of truth, no echo)", () => {
    const { core, onTabChange } = makeCore();
    core.syncFromUrl('protocole');
    assert.equal(onTabChange.calls.length, 0);
  });

  it("precedence URL > localStorage > default verified via syncFromUrl", () => {
    const { core } = makeCore({ initialStorage: { 'brainDrawer:lastTab': 'intelligence' } });
    core.syncFromUrl('reglages');
    assert.equal(get(core).tab, 'reglages');
  });
});

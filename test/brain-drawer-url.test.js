import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseBrainTab, buildUrlWithBrain } from "../src/lib/stores/brainDrawerUrl.js";

const VALID_TABS = ['connaissance', 'protocole', 'intelligence', 'reglages'];
const DEFAULT = 'connaissance';

describe("parseBrainTab", () => {
  it("returns the tab when present and valid", () => {
    const params = new URLSearchParams("brain=protocole");
    assert.equal(parseBrainTab(params, VALID_TABS, DEFAULT), 'protocole');
  });

  it("returns null when no brain param", () => {
    const params = new URLSearchParams("other=foo");
    assert.equal(parseBrainTab(params, VALID_TABS, DEFAULT), null);
  });

  it("returns default when brain param is invalid", () => {
    const params = new URLSearchParams("brain=notatab");
    assert.equal(parseBrainTab(params, VALID_TABS, DEFAULT), DEFAULT);
  });

  it("returns default for empty brain param", () => {
    const params = new URLSearchParams("brain=");
    assert.equal(parseBrainTab(params, VALID_TABS, DEFAULT), DEFAULT);
  });
});

describe("buildUrlWithBrain", () => {
  it("adds brain param when tab is provided", () => {
    const url = new URL("https://example.com/chat/abc");
    const next = buildUrlWithBrain(url, 'intelligence');
    assert.equal(next.searchParams.get('brain'), 'intelligence');
    assert.equal(next.pathname, '/chat/abc');
  });

  it("removes brain param when tab is null", () => {
    const url = new URL("https://example.com/chat/abc?brain=protocole");
    const next = buildUrlWithBrain(url, null);
    assert.equal(next.searchParams.has('brain'), false);
  });

  it("preserves other query params", () => {
    const url = new URL("https://example.com/chat/abc?conv=xyz");
    const next = buildUrlWithBrain(url, 'reglages');
    assert.equal(next.searchParams.get('conv'), 'xyz');
    assert.equal(next.searchParams.get('brain'), 'reglages');
  });

  it("does not mutate the input URL", () => {
    const url = new URL("https://example.com/chat/abc");
    buildUrlWithBrain(url, 'protocole');
    assert.equal(url.searchParams.has('brain'), false);
  });
});

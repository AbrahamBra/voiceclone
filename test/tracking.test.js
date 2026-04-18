import { test } from "node:test";
import assert from "node:assert/strict";
import { track } from "../src/lib/tracking.js";

test("track() is noop when window is undefined (SSR)", () => {
  assert.doesNotThrow(() => track("clone_created", { type: "posts" }));
});

test("track() is noop when plausible is missing", () => {
  globalThis.window = {};
  assert.doesNotThrow(() => track("clone_created"));
  delete globalThis.window;
});

test("track() calls window.plausible with event + props", () => {
  const calls = [];
  globalThis.window = {
    plausible: (event, opts) => calls.push([event, opts]),
  };
  track("clone_created", { type: "posts", has_docs: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "clone_created");
  assert.deepEqual(calls[0][1], { props: { type: "posts", has_docs: true } });
  delete globalThis.window;
});

test("track() swallows errors from plausible()", () => {
  globalThis.window = {
    plausible: () => { throw new Error("boom"); },
  };
  assert.doesNotThrow(() => track("x"));
  delete globalThis.window;
});

test("track() is noop when only the queue stub is present (data-domain unset)", () => {
  const calls = [];
  const stub = (event, opts) => calls.push([event, opts]);
  stub.q = [];
  globalThis.window = { plausible: stub };
  track("clone_created", { type: "posts" });
  assert.equal(calls.length, 0, "stub should not be called when .q queue still present");
  delete globalThis.window;
});

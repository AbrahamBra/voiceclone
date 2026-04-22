import { test } from "node:test";
import assert from "node:assert/strict";
import { withTimeout } from "../lib/with-timeout.js";

test("resolves when fn completes before deadline", async () => {
  const result = await withTimeout(async () => 42, 100, "fast");
  assert.equal(result, 42);
});

test("rejects with TIMEOUT error when fn exceeds deadline", async () => {
  const err = await withTimeout(
    (signal) => new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve("late"), 50);
      signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); });
    }),
    10,
    "slow",
  ).catch((e) => e);
  assert.equal(err.code, "TIMEOUT");
  assert.match(err.message, /slow timed out after 10ms/);
});

test("passes through non-timeout errors untouched", async () => {
  const err = await withTimeout(async () => { throw new Error("boom"); }, 100, "x")
    .catch((e) => e);
  assert.equal(err.message, "boom");
  assert.equal(err.code, undefined);
});

test("clears timer on early resolve (no hanging process)", async () => {
  const start = Date.now();
  await withTimeout(async () => "done", 10_000, "x");
  assert.ok(Date.now() - start < 100, "should return immediately, not wait for timeout");
});

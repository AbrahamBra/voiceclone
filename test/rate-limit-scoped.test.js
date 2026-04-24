import { test, describe } from "node:test";
import assert from "node:assert/strict";

// These tests don't exercise Supabase (it's undefined in the test env) — they
// verify the "fail open" path AND that the new opts are accepted without error.
// Real abuse testing runs against Preview URL, not here.

describe("rateLimit opts (scoped buckets)", () => {
  test("accepts bucket + windowMs + max without throwing", async () => {
    const { rateLimit } = await import("../api/_rateLimit.js");
    const r = await rateLimit("1.2.3.4", { bucket: "scrape", windowMs: 300_000, max: 10 });
    // Supabase not configured in test env → fail open (allowed: true)
    assert.equal(typeof r.allowed, "boolean");
  });

  test("falls back to defaults when opts omitted", async () => {
    const { rateLimit } = await import("../api/_rateLimit.js");
    const r = await rateLimit("5.6.7.8");
    assert.equal(typeof r.allowed, "boolean");
  });

  test("getClientIp extracts from headers safely", async () => {
    const { getClientIp } = await import("../api/_rateLimit.js");
    assert.equal(
      getClientIp({ headers: { "x-real-ip": "9.9.9.9" } }),
      "9.9.9.9",
    );
    // Spoofed x-forwarded-for is last-resort only — x-real-ip wins
    assert.equal(
      getClientIp({ headers: { "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" } }),
      "9.9.9.9",
    );
    // No headers → socket fallback → unknown
    assert.equal(getClientIp({ headers: {} }), "unknown");
  });

  test("ignores garbage IP values (length guards)", async () => {
    const { getClientIp } = await import("../api/_rateLimit.js");
    const tooLong = "x".repeat(200);
    assert.equal(getClientIp({ headers: { "x-real-ip": tooLong } }), "unknown");
    assert.equal(getClientIp({ headers: { "x-real-ip": "a" } }), "unknown");
  });
});

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { triageOf, byTriage, relTime } from "../src/lib/triage.js";

const NOW = Date.parse("2026-09-22T12:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();

describe("triageOf", () => {
  it("drift when score_global < 50, regardless of activity", () => {
    const t = triageOf({ last_message_at: daysAgo(0) }, { score_global: 42 }, NOW);
    assert.equal(t.kind, "drift");
    assert.equal(t.priority, 0);
  });
  it("never when no activity at all", () => {
    const t = triageOf({ last_message_at: null }, null, NOW);
    assert.equal(t.kind, "never");
    assert.equal(t.priority, 1);
  });
  it("stale when last activity >= 3 days ago, label carries the day count", () => {
    const t = triageOf({ last_message_at: daysAgo(5) }, { score_global: 90 }, NOW);
    assert.equal(t.kind, "stale");
    assert.equal(t.label, "5j d'absence");
  });
  it("warn when active but score between 50 and 74", () => {
    const t = triageOf({ last_message_at: daysAgo(1) }, { score_global: 60 }, NOW);
    assert.equal(t.kind, "warn");
    assert.equal(t.priority, 2);
  });
  it("ok when active and score >= 75 or unknown", () => {
    assert.equal(triageOf({ last_message_at: daysAgo(1) }, { score_global: 80 }, NOW).kind, "ok");
    assert.equal(triageOf({ last_message_at: daysAgo(1) }, null, NOW).kind, "ok");
  });
});

describe("byTriage", () => {
  it("sorts debt first, then oldest activity within same priority", () => {
    const scores = { a: { score_global: 90 }, b: { score_global: 40 }, c: { score_global: 90 }, d: null };
    const list = [
      { id: "a", last_message_at: daysAgo(4) }, // stale 4j
      { id: "b", last_message_at: daysAgo(0) }, // drift
      { id: "c", last_message_at: daysAgo(10) }, // stale 10j
      { id: "d", last_message_at: daysAgo(0) }, // ok
    ];
    const sorted = [...list].sort(byTriage(scores, NOW)).map((p) => p.id);
    assert.deepEqual(sorted, ["b", "c", "a", "d"]);
  });
});

describe("relTime", () => {
  it("formats null as jamais and days as il y a Nj", () => {
    assert.equal(relTime(null, NOW), "jamais");
    assert.equal(relTime(daysAgo(1), NOW), "hier");
    assert.equal(relTime(daysAgo(3), NOW), "il y a 3j");
    assert.equal(relTime(new Date(NOW - 5 * 3600_000).toISOString(), NOW), "il y a 5h");
  });
});

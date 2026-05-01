import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  isStaleArtifact,
  partitionByDecay,
  STALE_AFTER_DAYS,
} from "../lib/protocol-v2-decay.js";

const NOW = new Date("2026-04-30T00:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;

function isoDaysAgo(days) {
  return new Date(NOW - days * DAY).toISOString();
}

function makeArtifact(overrides = {}) {
  return {
    id: "a1",
    severity: "strong",
    is_manual_override: false,
    created_at: isoDaysAgo(200),
    stats: { fires: 0, last_fired_at: null },
    ...overrides,
  };
}

describe("isStaleArtifact", () => {
  it("decays artifacts older than STALE_AFTER_DAYS that never fired", () => {
    const a = makeArtifact({ created_at: isoDaysAgo(STALE_AFTER_DAYS + 10) });
    assert.equal(isStaleArtifact(a, { now: NOW }), true);
  });

  it("does NOT decay recent artifacts even if never fired", () => {
    const a = makeArtifact({ created_at: isoDaysAgo(30) });
    assert.equal(isStaleArtifact(a, { now: NOW }), false);
  });

  it("does NOT decay if last_fired_at is recent, even if old artifact", () => {
    const a = makeArtifact({
      created_at: isoDaysAgo(365),
      stats: { fires: 5, last_fired_at: isoDaysAgo(10) },
    });
    assert.equal(isStaleArtifact(a, { now: NOW }), false);
  });

  it("DOES decay if both created_at AND last_fired_at older than threshold", () => {
    const a = makeArtifact({
      created_at: isoDaysAgo(365),
      stats: { fires: 1, last_fired_at: isoDaysAgo(STALE_AFTER_DAYS + 10) },
    });
    assert.equal(isStaleArtifact(a, { now: NOW }), true);
  });

  it("never decays manual overrides", () => {
    const a = makeArtifact({
      is_manual_override: true,
      created_at: isoDaysAgo(365),
      stats: { fires: 0, last_fired_at: null },
    });
    assert.equal(isStaleArtifact(a, { now: NOW }), false);
  });

  it("never decays severity=hard", () => {
    const a = makeArtifact({
      severity: "hard",
      created_at: isoDaysAgo(365),
      stats: { fires: 0, last_fired_at: null },
    });
    assert.equal(isStaleArtifact(a, { now: NOW }), false);
  });

  it("decays severity=light same as strong", () => {
    const a = makeArtifact({
      severity: "light",
      created_at: isoDaysAgo(365),
      stats: { fires: 0, last_fired_at: null },
    });
    assert.equal(isStaleArtifact(a, { now: NOW }), true);
  });

  it("handles missing stats gracefully", () => {
    const a = makeArtifact({
      created_at: isoDaysAgo(365),
      stats: undefined,
    });
    assert.equal(isStaleArtifact(a, { now: NOW }), true);
  });

  it("returns false on null input", () => {
    assert.equal(isStaleArtifact(null), false);
  });

  it("respects custom staleAfterDays override", () => {
    const a = makeArtifact({ created_at: isoDaysAgo(40) });
    assert.equal(isStaleArtifact(a, { now: NOW, staleAfterDays: 30 }), true);
    assert.equal(isStaleArtifact(a, { now: NOW, staleAfterDays: 60 }), false);
  });
});

describe("partitionByDecay", () => {
  it("splits active vs decayed correctly", () => {
    const artifacts = [
      makeArtifact({ id: "fresh", created_at: isoDaysAgo(10) }),
      makeArtifact({ id: "stale", created_at: isoDaysAgo(365) }),
      makeArtifact({ id: "manual", is_manual_override: true, created_at: isoDaysAgo(365) }),
      makeArtifact({ id: "hard", severity: "hard", created_at: isoDaysAgo(365) }),
    ];
    const { active, decayed } = partitionByDecay(artifacts, { now: NOW });
    assert.deepEqual(active.map(a => a.id).sort(), ["fresh", "hard", "manual"]);
    assert.deepEqual(decayed.map(a => a.id), ["stale"]);
  });

  it("handles empty + null inputs", () => {
    assert.deepEqual(partitionByDecay([]), { active: [], decayed: [] });
    assert.deepEqual(partitionByDecay(null), { active: [], decayed: [] });
  });
});

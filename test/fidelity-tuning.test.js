import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { detectFidelityDecay } from "../lib/fidelity.js";

const makeScore = (score_global, daysAgo) => ({
  score_global,
  calculated_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
});

describe("detectFidelityDecay", () => {
  it("returns not decaying when fewer than 2 scores", () => {
    assert.deepEqual(detectFidelityDecay([makeScore(80, 0)]), { decaying: false });
    assert.deepEqual(detectFidelityDecay([]), { decaying: false });
  });

  it("returns not decaying when score is stable", () => {
    // -5pts over 7 days → weekly rate = -5, not > 8
    const scores = [makeScore(75, 0), makeScore(80, 7)];
    const result = detectFidelityDecay(scores);
    assert.equal(result.decaying, false);
    assert.equal(result.delta, -5);
  });

  it("returns not decaying when score improves", () => {
    const scores = [makeScore(85, 0), makeScore(75, 7)];
    const result = detectFidelityDecay(scores);
    assert.equal(result.decaying, false);
    assert.equal(result.delta, 10);
  });

  it("returns decaying when drop > 8pts over 7 days", () => {
    const scores = [makeScore(70, 0), makeScore(82, 7)];
    const result = detectFidelityDecay(scores);
    assert.equal(result.decaying, true);
    assert.equal(result.delta, -12);
  });

  it("returns decaying when drop > 8pts over fewer days (rate extrapolated to week)", () => {
    // -5pts over 3 days → weekly rate = -5/3*7 ≈ -11.7 → decaying
    const scores = [makeScore(75, 0), makeScore(80, 3)];
    const result = detectFidelityDecay(scores);
    assert.equal(result.decaying, true);
  });

  it("returns not decaying when drop > 8pts but spread over many weeks (slow drift)", () => {
    // -10pts over 28 days → weekly rate = -2.5 → not decaying
    const scores = [makeScore(70, 0), makeScore(80, 28)];
    const result = detectFidelityDecay(scores);
    assert.equal(result.decaying, false);
    assert.equal(result.delta, -10);
  });

  it("exposes weekly_rate in the result", () => {
    const scores = [makeScore(70, 0), makeScore(82, 7)];
    const result = detectFidelityDecay(scores);
    assert.ok(typeof result.weekly_rate === "number");
    assert.ok(result.weekly_rate < -8);
  });
});

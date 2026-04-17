import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  computeAdaptiveThreshold,
  clusterCorrections,
} from "../lib/correction-consolidation.js";

// --- computeAdaptiveThreshold ---

describe("computeAdaptiveThreshold", () => {
  it("returns the default 0.75 when embeddings.length < 5", () => {
    assert.equal(computeAdaptiveThreshold([]), 0.75);
    assert.equal(computeAdaptiveThreshold([[1, 0, 0]]), 0.75);
    assert.equal(computeAdaptiveThreshold([[1, 0], [0, 1], [1, 1], [0, 0]]), 0.75);
  });

  it("never returns a value below 0.65 (lower clamp)", () => {
    // All-identical embeddings → median ≈ 1, stddev ≈ 0 → raw threshold near 1
    // Orthogonal mix → median low, stddev high → raw could go negative, should clamp
    const orthogonal = [
      [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [1, 0, 0, 0],
    ];
    const t = computeAdaptiveThreshold(orthogonal);
    assert.ok(t >= 0.65, `expected ≥ 0.65, got ${t}`);
  });

  it("never returns a value above 0.85 (upper clamp)", () => {
    // All identical → median 1, stddev 0 → raw = 1 - 0 = 1 → clamp 0.85
    const identical = Array(6).fill([1, 0, 0]);
    const t = computeAdaptiveThreshold(identical);
    assert.ok(t <= 0.85, `expected ≤ 0.85, got ${t}`);
  });

  it("returns a value in [0.65, 0.85] for mixed embeddings", () => {
    const mixed = [
      [1, 0.1, 0], [0.9, 0.2, 0], [0.8, 0.3, 0.1], [0.1, 0.9, 0],
      [0, 0.8, 0.2], [0.1, 0, 0.9], [0, 0.1, 0.85],
    ];
    const t = computeAdaptiveThreshold(mixed);
    assert.ok(t >= 0.65 && t <= 0.85, `got ${t}`);
  });

  it("is deterministic for the same input", () => {
    const inp = [[1, 0], [0.9, 0.1], [0.1, 0.9], [0, 1], [0.5, 0.5], [0.4, 0.6]];
    assert.equal(computeAdaptiveThreshold(inp), computeAdaptiveThreshold(inp));
  });
});

// --- clusterCorrections ---

describe("clusterCorrections", () => {
  it("returns empty clusters for empty input", () => {
    const { clusters } = clusterCorrections([], []);
    assert.deepEqual(clusters, []);
  });

  it("exposes the threshold used for clustering", () => {
    const corrections = [{ id: "a" }, { id: "b" }];
    const embeddings = [[1, 0], [0, 1]];
    const { threshold } = clusterCorrections(corrections, embeddings);
    assert.equal(typeof threshold, "number");
    // With < 5 embeddings, threshold = DEFAULT (0.75)
    assert.equal(threshold, 0.75);
  });

  it("groups identical embeddings into a single cluster", () => {
    const corrections = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const v = [1, 0, 0];
    const { clusters } = clusterCorrections(corrections, [v, v, v]);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].members.length, 3);
  });

  it("separates orthogonal embeddings into distinct clusters", () => {
    const corrections = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const { clusters } = clusterCorrections(
      corrections,
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    );
    assert.equal(clusters.length, 3);
    for (const c of clusters) assert.equal(c.members.length, 1);
  });

  it("every correction ends up in exactly one cluster", () => {
    const corrections = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const embeddings = [[1, 0], [0.99, 0.01], [0, 1], [0.01, 0.99]];
    const { clusters } = clusterCorrections(corrections, embeddings);
    const allMembers = clusters.flatMap(c => c.members).sort((a, b) => a - b);
    assert.deepEqual(allMembers, [0, 1, 2, 3]);
  });

  it("similar embeddings cluster together when above adaptive threshold", () => {
    // 6 embeddings: 3 in one direction, 3 in another. With default threshold 0.75,
    // we expect 2 clusters of 3 each.
    const corrections = Array(6).fill(null).map((_, i) => ({ id: String(i) }));
    const embeddings = [
      [1, 0.01, 0], [0.99, 0.05, 0], [0.98, 0, 0.01],
      [0, 1, 0.02], [0.01, 0.99, 0], [0, 0.98, 0.05],
    ];
    const { clusters } = clusterCorrections(corrections, embeddings);
    assert.equal(clusters.length, 2, `expected 2 clusters, got ${clusters.length}`);
    assert.deepEqual(clusters.map(c => c.members.length).sort(), [3, 3]);
  });

  it("does not mutate input arrays", () => {
    const corrections = [{ id: "a" }, { id: "b" }];
    const embeddings = [[1, 0], [0, 1]];
    const embSnap = JSON.stringify(embeddings);
    const corrSnap = JSON.stringify(corrections);
    clusterCorrections(corrections, embeddings);
    assert.equal(JSON.stringify(embeddings), embSnap);
    assert.equal(JSON.stringify(corrections), corrSnap);
  });

  it("cluster.centroid has the same dimensionality as input embeddings", () => {
    const corrections = [{ id: "a" }, { id: "b" }];
    const embeddings = [[1, 0, 0, 0, 0], [1, 0, 0, 0, 0]];
    const { clusters } = clusterCorrections(corrections, embeddings);
    assert.equal(clusters[0].centroid.length, 5);
  });
});

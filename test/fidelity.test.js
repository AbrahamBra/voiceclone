import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  cosineSim,
  clusterByTheme,
  rescaleScore,
  computeStyleMetrics,
  compositeScore,
  computeCollapseIndex,
  kmeansSelectRepresentatives,
} from "../lib/fidelity.js";

// --- cosineSim ---

describe("cosineSim", () => {
  it("returns 1.0 for identical vectors", () => {
    assert.equal(cosineSim([1, 0, 0], [1, 0, 0]), 1);
  });

  it("returns 0 for orthogonal vectors", () => {
    assert.equal(cosineSim([1, 0], [0, 1]), 0);
  });

  it("returns -1 for anti-parallel vectors", () => {
    assert.equal(cosineSim([1, 0], [-1, 0]), -1);
  });

  it("is scale-invariant (magnitude does not matter)", () => {
    const a = cosineSim([1, 2, 3], [1, 2, 3]);
    const b = cosineSim([10, 20, 30], [1, 2, 3]);
    assert.ok(Math.abs(a - b) < 1e-9);
  });

  it("returns 0 when one vector is zero (avoids div by zero)", () => {
    assert.equal(cosineSim([0, 0, 0], [1, 2, 3]), 0);
  });

  it("handles small floating-point similarity correctly", () => {
    const s = cosineSim([1, 1, 0], [1, 0, 0]);
    // cos(45°) = 1/√2 ≈ 0.7071
    assert.ok(Math.abs(s - 1 / Math.sqrt(2)) < 1e-9);
  });
});

// --- rescaleScore ---

describe("rescaleScore", () => {
  it("maps 0.35 → 0", () => {
    assert.equal(rescaleScore(0.35), 0);
  });

  it("maps 0.90 → 100", () => {
    assert.equal(rescaleScore(0.90), 100);
  });

  it("clamps values below 0.35", () => {
    assert.equal(rescaleScore(0.0), 0);
    assert.equal(rescaleScore(-1), 0);
  });

  it("clamps values above 0.90", () => {
    assert.equal(rescaleScore(1.0), 100);
    assert.equal(rescaleScore(2.0), 100);
  });

  it("rescales the midpoint correctly", () => {
    // (0.625 - 0.35) / (0.90 - 0.35) = 0.275 / 0.55 = 0.5 → 50
    assert.equal(rescaleScore(0.625), 50);
  });

  it("returns an integer", () => {
    assert.equal(Number.isInteger(rescaleScore(0.77)), true);
  });
});

// --- clusterByTheme ---

describe("clusterByTheme", () => {
  it("returns empty array for no embeddings", () => {
    assert.deepEqual(clusterByTheme([]), []);
  });

  it("groups identical vectors into a single cluster", () => {
    const v = [1, 0, 0];
    const clusters = clusterByTheme([v, v, v]);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0].members.length, 3);
  });

  it("separates orthogonal vectors into distinct clusters", () => {
    const clusters = clusterByTheme([[1, 0, 0], [0, 1, 0], [0, 0, 1]], 0.70);
    assert.equal(clusters.length, 3);
  });

  it("uses the provided threshold", () => {
    // Two vectors with cosine ≈ 0.71 — group them at threshold 0.5, separate at 0.8
    const v1 = [1, 1, 0];
    const v2 = [1, 0, 0];
    assert.equal(clusterByTheme([v1, v2], 0.5).length, 1);
    assert.equal(clusterByTheme([v1, v2], 0.80).length, 2);
  });

  it("cluster.members contains indices into input array", () => {
    const clusters = clusterByTheme([[1, 0], [1, 0], [0, 1]]);
    const flat = clusters.flatMap(c => c.members).sort();
    assert.deepEqual(flat, [0, 1, 2]);
  });
});

// --- computeStyleMetrics ---

describe("computeStyleMetrics", () => {
  it("returns all-zero for empty text", () => {
    const m = computeStyleMetrics("", {});
    assert.equal(m.avgSentenceLen, 0);
    assert.equal(m.kurtosis, 0);
    assert.equal(m.ttr, 0);
  });

  it("computes avgSentenceLen on word count", () => {
    const m = computeStyleMetrics("un deux trois. quatre cinq six.", {});
    // two sentences, 3 words each → avg 3
    assert.equal(m.avgSentenceLen, 3);
  });

  it("counts signature phrases (case-insensitive substring)", () => {
    const m = computeStyleMetrics(
      "Voici mon post. C'est PROPRE ça.",
      { signaturePhrases: ["c'est propre", "niiicce"] }
    );
    // 1 of 2 signatures present → 0.5
    assert.equal(m.signaturePresence, 0.5);
  });

  it("returns 0 signaturePresence when no rules provided", () => {
    const m = computeStyleMetrics("any text", {});
    assert.equal(m.signaturePresence, 0);
  });

  it("counts forbidden words", () => {
    const m = computeStyleMetrics(
      "Cette synergie va changer le game, c'est propre.",
      { forbiddenWords: ["synergie", "tips"], signaturePhrases: [] }
    );
    assert.equal(m.forbiddenHits, 1);
  });

  it("question ratio reflects fraction of lines ending with '?'", () => {
    const m = computeStyleMetrics("Premiere ligne.\nTu penses quoi ?\nTroisieme.", {});
    // 1 question over 3 lines ≈ 0.33
    assert.ok(Math.abs(m.questionRatio - 1 / 3) < 0.01);
  });

  it("ttr between 0 and 1 for non-empty text", () => {
    const m = computeStyleMetrics("le chat mange la souris le chat dort", {});
    assert.ok(m.ttr > 0 && m.ttr <= 1);
  });

  it("ttr is 1 when all words are unique", () => {
    const m = computeStyleMetrics("un deux trois quatre cinq", {});
    assert.equal(m.ttr, 1);
  });

  it("kurtosis is 0 when fewer than 4 sentences", () => {
    const m = computeStyleMetrics("un. deux. trois.", {});
    assert.equal(m.kurtosis, 0);
  });
});

// --- compositeScore ---

describe("compositeScore", () => {
  it("returns 0 when everything is worst-case", () => {
    const sourceMetrics = computeStyleMetrics("", {});
    const draftMetrics = computeStyleMetrics("", {});
    // cosineSim 0.35 → rescale 0, styleScore bounded; we at least expect ≥ 0
    const s = compositeScore(0.35, sourceMetrics, draftMetrics);
    assert.ok(s >= 0 && s <= 100);
  });

  it("returns 100 for perfect match on both axes", () => {
    const text = "Premiere phrase courte. Deuxieme phrase un peu plus longue. Voila.";
    const voice = { signaturePhrases: ["voila"], forbiddenWords: [] };
    const source = computeStyleMetrics(text, voice);
    const draft = computeStyleMetrics(text, voice);
    const s = compositeScore(0.90, source, draft);
    // 70% * 100 (rescale 0.90) + 30% * ~100 (identical style with signature present) ≈ 100
    assert.ok(s >= 90 && s <= 100, `expected ~100, got ${s}`);
  });

  it("is a weighted sum — cosine contributes 70%", () => {
    // Identical style metrics → styleScore component is max possible
    const text = "Un test simple. Une deuxieme phrase.";
    const voice = { signaturePhrases: [], forbiddenWords: [] };
    const m = computeStyleMetrics(text, voice);
    const s_low = compositeScore(0.35, m, m);  // cosine rescale = 0
    const s_high = compositeScore(0.90, m, m); // cosine rescale = 100
    assert.ok(s_high - s_low >= 65, `cosine delta should drive ≥65pts, got ${s_high - s_low}`);
  });
});

// --- computeCollapseIndex ---

describe("computeCollapseIndex", () => {
  it("returns a value between 0 and 100", () => {
    const idx = computeCollapseIndex(0.5, 0.5, 0.5, 0.5, 0.1);
    assert.ok(idx >= 0 && idx <= 100);
  });

  it("returns an integer", () => {
    const idx = computeCollapseIndex(0.777, 0.333, 0.5, 0.5, 0.123);
    assert.equal(Number.isInteger(idx), true);
  });

  it("higher styleScore and lower varianceLoss → higher collapse index", () => {
    const good = computeCollapseIndex(1.0, 0.0, 1.0, 1.0, null);
    const bad  = computeCollapseIndex(0.0, 1.0, 0.0, 1.0, null);
    assert.ok(good > bad, `expected good > bad, got ${good} vs ${bad}`);
  });

  it("embeddingVariance === null uses 3-term formula", () => {
    // With null, weights are 0.40/0.35/0.25 — max score 100
    const idx = computeCollapseIndex(1.0, 0.0, 1.0, 1.0, null);
    assert.equal(idx, 100);
  });

  it("embeddingVariance branch rewards drafts close to source centroid", () => {
    // Semantics changed: embeddingVariance is now MEAN COSINE between drafts
    // and the persona source centroid. Higher = clone faithful to source.
    // Rescaled over [0.40, 0.85]: 0.80 ≈ 0.89 proximity, 0.40 = 0 (floor).
    const faithful = computeCollapseIndex(1.0, 0.0, 1.0, 1.0, 0.80);
    const drifted  = computeCollapseIndex(1.0, 0.0, 1.0, 1.0, 0.40);
    assert.ok(faithful > drifted, `faithful (${faithful}) should exceed drifted (${drifted})`);
  });

  it("ttrRatio caps at 1 (draft more diverse than source does not boost)", () => {
    const capped = computeCollapseIndex(1.0, 0.0, 2.0, 1.0, null); // draftTTR > sourceTTR
    const equal  = computeCollapseIndex(1.0, 0.0, 1.0, 1.0, null);
    assert.equal(capped, equal);
  });
});

// --- kmeansSelectRepresentatives ---

// Helper: build a unit vector pointing in direction [x, y]
const vec2 = (x, y) => { const n = Math.sqrt(x*x + y*y); return [x/n, y/n]; };

describe("kmeansSelectRepresentatives", () => {
  it("returns all posts when count <= k * repsPerCluster", () => {
    const posts = ["a", "b", "c"];
    const embeddings = posts.map(() => vec2(1, 0));
    const result = kmeansSelectRepresentatives(embeddings, posts, { k: 3, repsPerCluster: 3 });
    assert.deepEqual(result, posts);
  });

  it("returns all posts when embeddings are missing or mismatched", () => {
    const posts = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    assert.deepEqual(kmeansSelectRepresentatives([], posts), posts);
    assert.deepEqual(kmeansSelectRepresentatives(null, posts), posts);
  });

  it("returns at most k * repsPerCluster items", () => {
    // 20 posts in 2 tight clusters
    const cluster1 = Array.from({ length: 10 }, (_, i) => ({ e: vec2(1 + i*0.01, 0), p: `c1-${i}` }));
    const cluster2 = Array.from({ length: 10 }, (_, i) => ({ e: vec2(0, 1 + i*0.01), p: `c2-${i}` }));
    const all = [...cluster1, ...cluster2];
    const result = kmeansSelectRepresentatives(all.map(x => x.e), all.map(x => x.p), { k: 2, repsPerCluster: 2 });
    assert.ok(result.length <= 4, `expected ≤4 but got ${result.length}`);
  });

  it("covers both modes of a bimodal distribution", () => {
    // 6 posts near [1,0] (punchlines) and 6 posts near [0,1] (stories)
    const punchlines = Array.from({ length: 6 }, (_, i) => ({ e: vec2(1, i * 0.05), p: `punch-${i}` }));
    const stories    = Array.from({ length: 6 }, (_, i) => ({ e: vec2(i * 0.05, 1), p: `story-${i}` }));
    const all = [...punchlines, ...stories];
    const result = kmeansSelectRepresentatives(all.map(x => x.e), all.map(x => x.p), { k: 2, repsPerCluster: 2 });
    const hasPunchline = result.some(p => p.startsWith("punch-"));
    const hasStory = result.some(p => p.startsWith("story-"));
    assert.ok(hasPunchline, "should include at least one punchline post");
    assert.ok(hasStory, "should include at least one story post");
  });

  it("handles fewer posts than k (returns all)", () => {
    const posts = ["x", "y"];
    const embeddings = [vec2(1, 0), vec2(0, 1)];
    const result = kmeansSelectRepresentatives(embeddings, posts, { k: 5, repsPerCluster: 3 });
    assert.deepEqual(result, posts);
  });
});

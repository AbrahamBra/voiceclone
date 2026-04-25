/**
 * Pure vector-math and clustering utilities used by the fidelity pipeline.
 * No external dependencies — safe to import anywhere.
 */

/**
 * Cosine similarity between two vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function cosineSim(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Greedy clustering by cosine similarity against centroids with online centroid drift.
 * Shared primitive used by both theme clustering (fidelity) and correction clustering.
 * @param {number[][]} embeddings
 * @param {number} threshold - similarity above which an embedding joins an existing cluster
 * @returns {{ members: number[], centroid: number[] }[]}
 */
export function greedyCluster(embeddings, threshold) {
  const clusters = [];

  for (let i = 0; i < embeddings.length; i++) {
    const emb = embeddings[i];
    let bestCluster = -1;
    let bestSim = 0;

    for (let c = 0; c < clusters.length; c++) {
      const sim = cosineSim(emb, clusters[c].centroid);
      if (sim > threshold && sim > bestSim) {
        bestCluster = c;
        bestSim = sim;
      }
    }

    if (bestCluster >= 0) {
      const cluster = clusters[bestCluster];
      cluster.members.push(i);
      const n = cluster.members.length;
      for (let d = 0; d < emb.length; d++) {
        cluster.centroid[d] = cluster.centroid[d] * ((n - 1) / n) + emb[d] / n;
      }
    } else {
      clusters.push({ members: [i], centroid: [...emb] });
    }
  }

  return clusters;
}

/**
 * Theme clustering with a fixed similarity threshold (0.70 default).
 * Thin wrapper over greedyCluster preserved for existing call-sites.
 * @param {number[][]} embeddings
 * @param {number} threshold
 * @returns {{ members: number[], centroid: number[] }[]}
 */
export function clusterByTheme(embeddings, threshold = 0.70) {
  return greedyCluster(embeddings, threshold);
}

// Stopwords for local theme-label extraction (French + English common fillers).
// Intentionally conservative — we keep domain words (growth, startup, founder...).
const THEME_STOPWORDS = new Set([
  "alors","donc","mais","parce","quand","comme","avec","sans","pour","dans","vers","chez","sous",
  "cette","celui","celle","ceux","elles","leurs","notre","votre","leur","quelques","chaque",
  "etre","avoir","faire","dire","aller","voir","savoir","pouvoir","vouloir","devoir","falloir",
  "tres","bien","aussi","encore","toujours","jamais","plus","moins","trop","beaucoup","peut",
  "tout","tous","toute","toutes","autre","autres","meme","memes","autant","ainsi","enfin","puis",
  "ensuite","avant","apres","pendant","dont","lequel","laquelle","lesquels","lesquelles",
  "les","des","une","est","son","ses","ton","mon","ces","aux","par","sur","qui","que","quoi",
  "ils","elle","nous","vous","moi","toi","lui","leur","cela","cet","ont","ete",
  "that","this","these","those","with","from","about","your","their","would","could","should",
  "have","been","were","will","shall","just","only","more","most","very","much","some","what",
  "when","where","which","while","whom","into","over","under","than","then","also","even","such",
  "they","them","there","here","because","through","between","being","into","without","within",
]);

/**
 * Extract a short theme label locally from cluster sample texts.
 * Used as fallback when Haiku labelling fails.
 * @param {string[]} samples
 * @returns {string|null}
 */
export function extractLocalThemeLabel(samples) {
  if (!samples || samples.length === 0) return null;
  const text = samples.join(" ").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s'-]/g, " ");
  const words = text.split(/\s+/).filter(w => w.length >= 4 && !THEME_STOPWORDS.has(w));
  if (words.length === 0) return null;
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w]) => w);
  if (top.length === 0) return null;
  return top[0].charAt(0).toUpperCase() + top[0].slice(1) + (top[1] ? " " + top[1] : "");
}

/**
 * Rescale a raw similarity score from [0.35, 0.90] to [0, 100].
 * @param {number} raw
 * @returns {number}
 */
export function rescaleScore(raw) {
  const clamped = Math.max(0.35, Math.min(0.90, raw));
  return Math.round(((clamped - 0.35) / (0.90 - 0.35)) * 100);
}

/**
 * K-means with K-means++ init: pick representative posts per cluster.
 * Falls back to returning all posts when there are too few to cluster.
 * @param {number[][]|null} embeddings - one per post
 * @param {string[]} posts
 * @param {{ k?: number, repsPerCluster?: number, maxIter?: number }} [options]
 * @returns {string[]}
 */
export function kmeansSelectRepresentatives(embeddings, posts, { k = 3, repsPerCluster = 3, maxIter = 20 } = {}) {
  if (!embeddings || embeddings.length !== posts.length || posts.length <= k * repsPerCluster) {
    return posts;
  }

  const n = embeddings.length;
  const dim = embeddings[0].length;
  const numCenters = Math.min(k, n);

  // K-means++ initialisation: spread centers by weighted distance
  const centerIdx = [Math.floor(Math.random() * n)];
  while (centerIdx.length < numCenters) {
    const dists = embeddings.map((e, i) => {
      if (centerIdx.includes(i)) return 0;
      const maxSim = Math.max(...centerIdx.map(ci => cosineSim(e, embeddings[ci])));
      return Math.max(0, 1 - maxSim);
    });
    const total = dists.reduce((a, b) => a + b, 0);
    if (total === 0) break;
    let r = Math.random() * total;
    let chosen = n - 1;
    for (let i = 0; i < n; i++) { r -= dists[i]; if (r <= 0) { chosen = i; break; } }
    centerIdx.push(chosen);
  }

  let centers = centerIdx.map(i => [...embeddings[i]]);
  let assignments = new Array(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    const next = embeddings.map(e => {
      let best = 0, bestSim = -Infinity;
      for (let c = 0; c < centers.length; c++) {
        const s = cosineSim(e, centers[c]);
        if (s > bestSim) { bestSim = s; best = c; }
      }
      return best;
    });

    if (next.every((a, i) => a === assignments[i])) break;
    assignments = next;

    const sums = centers.map(() => new Array(dim).fill(0));
    const counts = new Array(centers.length).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      for (let d = 0; d < dim; d++) sums[c][d] += embeddings[i][d];
      counts[c]++;
    }
    centers = sums.map((s, c) => counts[c] > 0 ? s.map(v => v / counts[c]) : centers[c]);
  }

  const selected = new Set();
  for (let c = 0; c < centers.length; c++) {
    assignments
      .map((a, i) => (a === c ? { i, sim: cosineSim(embeddings[i], centers[c]) } : null))
      .filter(Boolean)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, repsPerCluster)
      .forEach(({ i }) => selected.add(i));
  }

  return [...selected].sort((a, b) => a - b).map(i => posts[i]);
}

/**
 * Detect fidelity score decay from a chronologically-ordered list of scores.
 * @param {{ score_global: number, calculated_at: string }[]} scores - most recent first
 * @returns {{ decaying: boolean, delta?: number, weekly_rate?: number }}
 */
export function detectFidelityDecay(scores) {
  if (!scores || scores.length < 2) return { decaying: false };

  const latest = scores[0];
  const previous = scores[1];
  const delta = latest.score_global - previous.score_global;

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysDiff = (new Date(latest.calculated_at) - new Date(previous.calculated_at)) / msPerDay;
  const weeklyRate = daysDiff > 0 ? (delta / daysDiff) * 7 : delta;

  return {
    decaying: weeklyRate < -8,
    delta,
    weekly_rate: Math.round(weeklyRate * 10) / 10,
  };
}

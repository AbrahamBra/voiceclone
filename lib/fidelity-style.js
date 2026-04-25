/**
 * Style metrics and collapse detection for the fidelity pipeline.
 * No external dependencies — safe to import anywhere.
 */

import { rescaleScore } from "./fidelity-math.js";

/**
 * Extract quantitative style metrics from a text.
 * @param {string} text
 * @param {object} voiceRules - { signaturePhrases, forbiddenWords }
 */
export function computeStyleMetrics(text, voiceRules = {}) {
  const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 0);
  if (sentences.length === 0) {
    return { avgSentenceLen: 0, sentenceLenStd: 0, kurtosis: 0, sentenceLenEntropy: 0,
      questionRatio: 0, questionPlacementVar: 0, ttr: 0, signaturePresence: 0, forbiddenHits: 0 };
  }

  const wordCounts = sentences.map(s => s.split(/\s+/).length);
  const n = wordCounts.length;
  const avgSentenceLen = wordCounts.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? wordCounts.reduce((s, v) => s + (v - avgSentenceLen) ** 2, 0) / n : 0;
  const sentenceLenStd = Math.sqrt(variance);

  let kurtosis = 0;
  if (n >= 4 && sentenceLenStd > 0) {
    const m4 = wordCounts.reduce((s, v) => s + ((v - avgSentenceLen) / sentenceLenStd) ** 4, 0) / n;
    kurtosis = m4 - 3;
  }

  // Shannon entropy of sentence-length distribution — primary anti-uniformization signal.
  let sentenceLenEntropy = 0;
  if (n >= 2) {
    const bins = [0, 0, 0, 0];
    for (const w of wordCounts) {
      if (w <= 5) bins[0]++;
      else if (w <= 10) bins[1]++;
      else if (w <= 18) bins[2]++;
      else bins[3]++;
    }
    let h = 0;
    for (const b of bins) {
      if (b > 0) { const p = b / n; h -= p * Math.log2(p); }
    }
    sentenceLenEntropy = h / 2; // normalized to [0,1] (log2(4) = 2 max)
  }

  const lines = text.split(/\n+/).filter(l => l.trim().length > 0);
  const questionPositions = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().endsWith("?")) questionPositions.push(i / Math.max(lines.length - 1, 1));
  }
  const questionRatio = questionPositions.length / Math.max(lines.length, 1);

  let questionPlacementVar = 0;
  if (questionPositions.length >= 2) {
    const qMean = questionPositions.reduce((a, b) => a + b, 0) / questionPositions.length;
    questionPlacementVar = questionPositions.reduce((s, v) => s + (v - qMean) ** 2, 0) / questionPositions.length;
  }

  // Adaptive TTR window: min(200, 40% of total) to reveal drift on short French posts.
  const allWords = text.toLowerCase().replace(/[^a-zàâéèêëïîôùûüç\s'-]/g, "").split(/\s+/).filter(w => w.length > 1);
  const windowSize = Math.max(10, Math.min(200, Math.ceil(allWords.length * 0.4)));
  const window = allWords.slice(-windowSize);
  const ttr = window.length > 0 ? new Set(window).size / window.length : 0;

  let signaturePresence = 0;
  if (voiceRules.signaturePhrases?.length) {
    const lower = text.toLowerCase();
    const found = voiceRules.signaturePhrases.filter(p => lower.includes(p.toLowerCase())).length;
    signaturePresence = found / voiceRules.signaturePhrases.length;
  }

  let forbiddenHits = 0;
  if (voiceRules.forbiddenWords?.length) {
    const lower = text.toLowerCase();
    for (const w of voiceRules.forbiddenWords) {
      if (w && lower.includes(w.toLowerCase())) forbiddenHits++;
    }
  }

  return { avgSentenceLen, sentenceLenStd, kurtosis, sentenceLenEntropy,
    questionRatio, questionPlacementVar, ttr, signaturePresence, forbiddenHits };
}

/**
 * Compute style similarity between source and draft metrics. Returns [0, 1].
 */
export function styleScore(sourceMetrics, draftMetrics) {
  const lenSim = sourceMetrics.avgSentenceLen > 0
    ? Math.max(0, 1 - Math.abs(sourceMetrics.avgSentenceLen - draftMetrics.avgSentenceLen) / sourceMetrics.avgSentenceLen)
    : 1;
  const kurtSim = Math.max(0, 1 - Math.abs(sourceMetrics.kurtosis - draftMetrics.kurtosis) / Math.max(Math.abs(sourceMetrics.kurtosis), 1));
  const entropySim = 1 - Math.abs(sourceMetrics.sentenceLenEntropy - draftMetrics.sentenceLenEntropy);
  const qSim = 1 - Math.abs(sourceMetrics.questionRatio - draftMetrics.questionRatio);
  const qpSim = Math.max(0, 1 - Math.abs(sourceMetrics.questionPlacementVar - draftMetrics.questionPlacementVar) / Math.max(sourceMetrics.questionPlacementVar, 0.01));
  const ttrSim = sourceMetrics.ttr > 0
    ? Math.max(0, 1 - Math.abs(sourceMetrics.ttr - draftMetrics.ttr) / sourceMetrics.ttr)
    : 1;
  const sigScore = draftMetrics.signaturePresence;
  const forbiddenClean = draftMetrics.forbiddenHits === 0 ? 1.0 : 0.0;

  return 0.18 * lenSim + 0.05 * kurtSim + 0.12 * entropySim + 0.12 * qSim + 0.03 * qpSim
       + 0.18 * ttrSim + 0.18 * sigScore + 0.14 * forbiddenClean;
}

/**
 * Compute composite fidelity score: 70% cosine + 30% style metrics.
 */
export function compositeScore(cosine, sourceMetrics, draftMetrics) {
  const style = styleScore(sourceMetrics, draftMetrics);
  return 0.70 * rescaleScore(cosine) + 0.30 * (style * 100);
}

/**
 * Compute average style metrics across multiple source texts.
 */
export function averageStyleMetrics(texts, voiceRules) {
  const zero = { avgSentenceLen: 0, sentenceLenStd: 0, kurtosis: 0, sentenceLenEntropy: 0,
    questionRatio: 0, questionPlacementVar: 0, ttr: 0, signaturePresence: 0, forbiddenHits: 0 };
  if (texts.length === 0) return zero;
  const all = texts.map(t => computeStyleMetrics(t, voiceRules));
  const n = all.length;
  const avg = (key) => all.reduce((s, m) => s + m[key], 0) / n;
  return {
    avgSentenceLen: avg("avgSentenceLen"),
    sentenceLenStd: avg("sentenceLenStd"),
    kurtosis: avg("kurtosis"),
    sentenceLenEntropy: avg("sentenceLenEntropy"),
    questionRatio: avg("questionRatio"),
    questionPlacementVar: avg("questionPlacementVar"),
    ttr: avg("ttr"),
    signaturePresence: avg("signaturePresence"),
    forbiddenHits: 0, // source is clean by definition
  };
}

/**
 * Normalized variance loss: per-dimension relative distance, averaged. [0, 1].
 */
export function normalizedVarianceLoss(sourceMetrics, draftMetrics) {
  const relativeDims = ["sentenceLenStd", "kurtosis", "questionPlacementVar", "ttr"];
  let totalLoss = 0;
  let count = 0;
  for (const key of relativeDims) {
    const src = sourceMetrics[key] ?? 0;
    const draft = draftMetrics[key] ?? 0;
    const denom = Math.max(Math.abs(src), 0.01);
    totalLoss += Math.min(Math.abs(src - draft) / denom, 1.0);
    count++;
  }
  totalLoss += Math.abs((sourceMetrics.sentenceLenEntropy ?? 0) - (draftMetrics.sentenceLenEntropy ?? 0));
  count++;
  return count > 0 ? totalLoss / count : 0;
}

/**
 * Compute collapse index: multi-dimensional style preservation score [0, 100].
 * @param {number} styleSc - styleScore result [0, 1]
 * @param {number} varianceLoss - normalizedVarianceLoss result [0, 1]
 * @param {number} draftTTR
 * @param {number} sourceTTR
 * @param {number|null} embeddingVariance - mean cosine draft→source centroid (null if unavailable)
 */
export function computeCollapseIndex(styleSc, varianceLoss, draftTTR, sourceTTR, embeddingVariance = null) {
  const ttrRatio = sourceTTR > 0 ? Math.min(draftTTR / sourceTTR, 1.0) : 1;

  let base = 0.40 * styleSc + 0.35 * (1 - varianceLoss) + 0.25 * ttrRatio;

  if (embeddingVariance !== null) {
    const driftProximity = Math.max(0, Math.min(1, (embeddingVariance - 0.40) / (0.85 - 0.40)));
    base = 0.35 * styleSc + 0.25 * (1 - varianceLoss) + 0.20 * ttrRatio + 0.20 * driftProximity;
  }

  return Math.round(base * 100);
}

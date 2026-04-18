/**
 * Mahalanobis diagonal (z-score agrégé) — cold-start baseline.
 *
 * v1 : matrice de covariance supposée diagonale (pas de cross-correlations).
 *   Distance = sqrt(Σ ((x_i − μ_i) / σ_i)²)
 *   Robuste avec N petit (~25 samples) ; pas d'inversion de matrice à risque
 *   de singularité. On passe à la full-cov avec shrinkage en v2 quand N ≥ 50.
 *
 * Les dimensions utilisées sont configurables pour pouvoir exclure les
 * métriques trop corrélées à la taille (n_sentences, initial_repeat_max).
 */

// Dimensions retenues pour le baseline v1.2.
// Exclus :
//   - rm_n_sentences : dépendant de la taille du message
//   - rm_initial_repeat_max : compteur sparse, rarement informatif
//   - rm_dryness : encode une mécanique commerciale (« finir par ? »),
//     déjà du ressort des règles setter D2/D3. Laisser le critic rythme
//     mesurer du rythme, pas des prescriptions métier. Retiré en v1.2 après
//     constat de duplication + faux positifs sur follow-ups courts légitimes.
export const BASELINE_DIMS = [
  "rm_len_mean",
  "rm_len_std",
  "rm_len_cv",
  "rm_short_ratio",
  "rm_long_ratio",
  "rm_transition_rate",
  "rm_fragment_ratio",
];

// σ minimal pour éviter division par ~0 quand une dim a 0 variance sur le gold.
const MIN_STD = 0.05;

/**
 * Calcule mean et std sur un ensemble de vecteurs (chaque vecteur = objet signals).
 * @param {object[]} vectors - liste d'objets avec les clés BASELINE_DIMS
 * @returns {{ mean: object, std: object, sample_count: number }}
 */
export function computeBaseline(vectors) {
  if (!vectors?.length) throw new Error("computeBaseline: empty vectors");
  const n = vectors.length;
  const mean = {};
  const std = {};

  for (const dim of BASELINE_DIMS) {
    const vals = vectors.map(v => Number(v[dim]) || 0);
    const mu = vals.reduce((a, b) => a + b, 0) / n;
    const variance = n > 1
      ? vals.reduce((a, b) => a + (b - mu) ** 2, 0) / (n - 1)
      : 0;
    mean[dim] = +mu.toFixed(4);
    std[dim] = +Math.max(Math.sqrt(variance), MIN_STD).toFixed(4);
  }

  return { mean, std, sample_count: n };
}

/**
 * Distance Mahalanobis diagonale entre un vecteur et un baseline.
 * Retourne { distance, per_dim_z, dominant_dim }.
 */
export function mahalanobisDistance(vector, baseline) {
  if (!baseline?.mean || !baseline?.std) return null;
  const perDim = {};
  let sumSq = 0;
  let maxAbsZ = 0;
  let dominant = null;

  for (const dim of BASELINE_DIMS) {
    const x = Number(vector[dim]) || 0;
    const mu = Number(baseline.mean[dim]) || 0;
    const sigma = Math.max(Number(baseline.std[dim]) || MIN_STD, MIN_STD);
    const z = (x - mu) / sigma;
    perDim[dim] = +z.toFixed(3);
    sumSq += z * z;
    if (Math.abs(z) > maxAbsZ) {
      maxAbsZ = Math.abs(z);
      dominant = dim;
    }
  }

  return {
    distance: +Math.sqrt(sumSq).toFixed(3),
    per_dim_z: perDim,
    dominant_dim: dominant,
    dominant_z: +maxAbsZ.toFixed(3),
  };
}

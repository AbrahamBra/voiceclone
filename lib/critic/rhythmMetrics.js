/**
 * Signal B — micro-métriques rythmiques brutes.
 *
 * Principe : on ne fixe AUCUN seuil ici. On logue les valeurs dans
 * `rhythm_shadow.signals` à chaque génération. Les seuils seront appris
 * plus tard par distance distributionnelle (Mahalanobis) vs le corpus
 * `messages.is_gold = true` de la persona, puis par régression logistique
 * sur `rhythm_prefs` une fois ~100 paires accumulées.
 *
 * Exporté comme une seule fonction `computeRhythmMetrics(text)` -> objet plat
 * jsonb-serializable, préfixé `rm_` pour se co-loger avec les signaux setter
 * dans le même JSONB sans collision.
 */

const WORD = /[a-zàâäéèêëïîôöùûüç'][a-zàâäéèêëïîôöùûüç'-]*/gi;
const SENTENCE_SPLIT = /(?<=[.!?…])\s+(?=[A-ZÀÂÉÈÊ0-9])/;
// Verbes = approx. Faute d'un POS tagger léger en JS, on détecte la présence
// d'au moins une forme verbale conjuguée très fréquente ou d'un auxiliaire.
// C'est un proxy, pas une vérité. Suffisant comme métrique continue.
const VERB_HINT = /\b(suis|es|est|sommes|êtes|sont|étais|était|étions|étaient|serai|sera|ai|as|a|avons|avez|ont|avais|avait|avions|avaient|aurai|aura|fais|fait|faisons|faites|font|peux|peut|pouvons|pouvez|peuvent|veux|veut|voulons|voulez|veulent|dois|doit|devons|devez|doivent|vais|va|allons|allez|vont|prends|prend|prenons|prenez|prennent|dis|dit|disons|dites|disent|vois|voit|voyons|voyez|voient|sais|sait|savons|savez|savent)\b|\b\w+(ons|ez|ent|ais|ait|aient|erai|eras|era|erons|erez|eront|é|ée|és|ées|ant)\b/i;

function words(text) {
  return (text.match(WORD) || []);
}

function sentences(text) {
  return text.split(SENTENCE_SPLIT).map(s => s.trim()).filter(Boolean);
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdev(arr, mu) {
  if (arr.length < 2) return 0;
  const m = typeof mu === "number" ? mu : mean(arr);
  const v = arr.reduce((a, b) => a + (b - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
}

/**
 * @param {string} text
 * @returns {object} signaux jsonb-safe, préfixés `rm_`
 */
export function computeRhythmMetrics(text) {
  const sents = sentences(text);
  const n = sents.length;
  if (!n) {
    return {
      rm_n_sentences: 0,
      rm_len_mean: 0,
      rm_len_std: 0,
      rm_len_cv: 0,
      rm_short_ratio: 0,
      rm_long_ratio: 0,
      rm_transition_rate: 0,
      rm_fragment_ratio: 0,
      rm_initial_repeat_max: 0,
      rm_dryness: 0,
    };
  }

  const lens = sents.map(s => words(s).length);
  const mu = mean(lens);
  const sd = stdev(lens, mu);

  const short = lens.filter(l => l <= 6).length;
  const long = lens.filter(l => l >= 20).length;

  // Transitions short<->long (ruptures de tempo)
  let transitions = 0;
  for (let i = 1; i < n; i++) {
    const a = lens[i - 1] <= 6 ? "s" : lens[i - 1] >= 20 ? "l" : "m";
    const b = lens[i] <= 6 ? "s" : lens[i] >= 20 ? "l" : "m";
    if ((a === "s" && b === "l") || (a === "l" && b === "s")) transitions++;
  }

  // Fragments sans verbe (proxy) — signal positif généralement (coupure sèche)
  const fragments = sents.filter(s => !VERB_HINT.test(s)).length;

  // Répétition d'initiales : max run de phrases commençant par le même mot
  const initials = sents.map(s => (words(s)[0] || "").toLowerCase());
  let maxRun = 1, run = 1;
  for (let i = 1; i < initials.length; i++) {
    if (initials[i] && initials[i] === initials[i - 1]) {
      run++;
      if (run > maxRun) maxRun = run;
    } else {
      run = 1;
    }
  }

  // "Dryness" : ratio de phrases terminées par un point sec (vs. !?…)
  const dry = sents.filter(s => /\.\s*$/.test(s)).length;

  return {
    rm_n_sentences: n,
    rm_len_mean: +mu.toFixed(3),
    rm_len_std: +sd.toFixed(3),
    rm_len_cv: mu > 0 ? +(sd / mu).toFixed(3) : 0,
    rm_short_ratio: +(short / n).toFixed(3),
    rm_long_ratio: +(long / n).toFixed(3),
    rm_transition_rate: n > 1 ? +(transitions / (n - 1)).toFixed(3) : 0,
    rm_fragment_ratio: +(fragments / n).toFixed(3),
    rm_initial_repeat_max: maxRun,
    rm_dryness: +(dry / n).toFixed(3),
  };
}

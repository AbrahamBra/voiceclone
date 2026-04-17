// Pre-scripted pipeline demos for the landing lab.
// Each scenario walks the viewer through: prompt -> generate (pass 1) ->
// checks -> optional rewrite -> fidelity -> done. Data is frozen; no API call.
//
// Timings are in milliseconds, relative to the start of each scenario.
// The runner plays back sequentially; total ~10s per scenario => ~30s loop.

/**
 * @typedef {Object} Scenario
 * @property {string} id
 * @property {string} label
 * @property {string} prompt_context   Short framing line shown above the prompt
 * @property {string} prompt_text      What the "user" is typing
 * @property {string} pass1_text       Model's first draft (streamed)
 * @property {Array<{rule: string, severity: 'hard'|'strong'|'light', detail: string, fires_at_ms: number}>} rules
 * @property {Array<{name: string, from: number, to: number}>} metrics  Collapse index, TTR, kurtosis, q/s
 * @property {number} fidelity_before
 * @property {number} fidelity_after
 * @property {string|null} pass2_text  Rewritten output (null if no rewrite)
 * @property {'pass'|'rewrite'|'drift'} outcome
 */

/** @type {Scenario[]} */
export const SCENARIOS = [
  {
    id: "pass",
    label: "CAS 01 / PASSE PROPRE",
    prompt_context: "entrant LinkedIn — CTO fintech, 40 personnes, série B",
    prompt_text: "Ecris un premier message de prise de contact.",
    pass1_text:
      "Salut Marc, j'ai vu ta levée la semaine dernière — félicitations. Une question honnête : sur 40 personnes, combien sont effectivement sur la route pour vendre vs. dans le produit ? Je creuse ça parce qu'on voit souvent des séries B où la montée en charge commerciale est le vrai goulot, pas la tech. Pas d'agenda caché, juste curieux.",
    rules: [
      { rule: "forbidden_word", severity: "hard", detail: "—", fires_at_ms: 0 },
      { rule: "self_reveal", severity: "hard", detail: "—", fires_at_ms: 0 },
      { rule: "ai_pattern_fr", severity: "hard", detail: "—", fires_at_ms: 0 },
      { rule: "ai_cliche", severity: "strong", detail: "—", fires_at_ms: 0 },
      { rule: "markdown", severity: "strong", detail: "—", fires_at_ms: 0 },
      { rule: "fidelity_drift", severity: "strong", detail: "—", fires_at_ms: 0 },
    ],
    metrics: [
      { name: "collapse_idx", from: 82, to: 87 },
      { name: "ttr", from: 0.64, to: 0.71 },
      { name: "kurtosis", from: 2.1, to: 2.4 },
      { name: "q_ratio", from: 0.14, to: 0.18 },
    ],
    fidelity_before: 0.812,
    fidelity_after: 0.834,
    pass2_text: null,
    outcome: "pass",
  },
  {
    id: "rewrite",
    label: "CAS 02 / RÉÉCRITURE DURE",
    prompt_context: "relance après 7 jours — prospect chaud, stack e-commerce",
    prompt_text: "Relance-le. Pas trop commercial.",
    pass1_text:
      "**Bonjour Sophie**, il est crucial que nous reprenions contact. En conclusion de nos échanges précédents, je pense qu'il est important de noter que notre solution permet de résoudre fondamentalement vos enjeux. La vraie question c'est : n'hésitez pas à revenir vers moi.",
    rules: [
      { rule: "forbidden_word", severity: "hard", detail: "—", fires_at_ms: 0 },
      { rule: "self_reveal", severity: "hard", detail: "—", fires_at_ms: 0 },
      { rule: "ai_pattern_fr", severity: "hard", detail: "la vraie question c'est", fires_at_ms: 1000 },
      { rule: "ai_cliche", severity: "strong", detail: "crucial · en conclusion · il est important de noter · fondamentalement · n'hésitez pas", fires_at_ms: 900 },
      { rule: "markdown", severity: "strong", detail: "**Bonjour Sophie**", fires_at_ms: 600 },
      { rule: "fidelity_drift", severity: "strong", detail: "cosine=0.612 < 0.72", fires_at_ms: 1200 },
    ],
    metrics: [
      { name: "collapse_idx", from: 41, to: 78 },
      { name: "ttr", from: 0.48, to: 0.67 },
      { name: "kurtosis", from: 1.3, to: 2.2 },
      { name: "q_ratio", from: 0.03, to: 0.22 },
    ],
    fidelity_before: 0.612,
    fidelity_after: 0.801,
    pass2_text:
      "Sophie, pas de nouvelles depuis 7 jours — j'ai deux hypothèses : soit le sujet est redescendu dans ta pile, soit quelque chose coince que j'ai raté. Les deux sont légitimes, j'aimerais juste savoir laquelle c'est pour ne pas te relancer dans le vide. 2 lignes suffisent.",
    outcome: "rewrite",
  },
  {
    id: "drift",
    label: "CAS 03 / DÉRIVE DE FIDÉLITÉ",
    prompt_context: "appel découverte — note rapide post-réunion",
    prompt_text: "Rédige mon compte-rendu en 3 bullets.",
    pass1_text:
      "Voici le compte-rendu structuré de l'appel. Premièrement, les besoins identifiés sont multiples. Deuxièmement, le budget semble aligné. Troisièmement, les prochaines étapes sont claires et permettent de faire avancer le projet efficacement.",
    rules: [
      { rule: "forbidden_word", severity: "hard", detail: "—", fires_at_ms: 0 },
      { rule: "self_reveal", severity: "hard", detail: "—", fires_at_ms: 0 },
      { rule: "ai_pattern_fr", severity: "hard", detail: "—", fires_at_ms: 0 },
      { rule: "ai_cliche", severity: "strong", detail: "permettre de", fires_at_ms: 1100 },
      { rule: "markdown", severity: "strong", detail: "—", fires_at_ms: 0 },
      { rule: "fidelity_drift", severity: "strong", detail: "cosine=0.681 < 0.72", fires_at_ms: 1400 },
    ],
    metrics: [
      { name: "collapse_idx", from: 55, to: 55 },
      { name: "ttr", from: 0.52, to: 0.52 },
      { name: "kurtosis", from: 1.6, to: 1.6 },
      { name: "q_ratio", from: 0.00, to: 0.00 },
    ],
    fidelity_before: 0.681,
    fidelity_after: 0.681,
    pass2_text: null,
    outcome: "drift",
  },
];

/** Characters per millisecond for the typewriter effect on prompt + output. */
export const TYPE_SPEED_PROMPT = 0.04; // ~40 char/s
export const TYPE_SPEED_OUTPUT = 0.12; // ~120 char/s — faster, it's "streaming"

/** Delay between phases of a scenario. */
export const PHASE_DELAYS = {
  prompt_to_thinking: 200,
  thinking_to_stream: 300,
  stream_end_to_checks: 200,
  checks_to_rewrite: 500,
  rewrite_end_to_done: 300,
  done_to_next: 2200,
};

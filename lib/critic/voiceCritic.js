/**
 * Voice Critic — règles lexicales persona-spécifiques.
 *
 * Complément au RhythmCritic (structure) et au SetterBaseline (mécaniques
 * universelles). Cible la voix explicite déclarée dans persona.json :
 * forbiddenWords, signaturePhrases, règles grammaticales par persona.
 *
 * Scope v1 — règles parseables uniquement :
 *   V1. forbiddenWords          → hard flag (1.0)
 *   V2. verbe anglais conjugué  → hard flag (1.0)
 *   V3. tiret/dash connecteur   → soft flag (0.4)
 *   V4. signaturePhrases        → bonus informatif (pas de flag)
 *
 * Volontairement NON inclus à ce stade :
 *   - tu/vous ratio (nécessite de connaître le style du prospect)
 *   - longueur 5-15 mots (déjà couvert par setter A1)
 *   - « pas de pitch en ouverture » (déjà couvert par setter C3)
 */

// Verbes anglais fréquemment conjugués à la française (anti-pattern Thomas).
const EN_VERBS = [
  "find", "scale", "push", "drive", "manage", "ship", "build", "craft",
  "leverage", "deliver", "run", "grow", "boost", "pitch", "close",
  "onboard", "reach", "send", "connect", "ping", "book", "setup",
];

const SUBJ_FR = "(je|tu|il|elle|on|nous|vous|ils|elles)";
const VERB_END = "(s|es|e|ed|ing|ent|ons|ez|ait|ais|aient|era|eras|erez|é|ée|és|ées|ant)?";
const ANGLICIZED_RE = new RegExp(`\\b${SUBJ_FR}\\s+(${EN_VERBS.join("|")})${VERB_END}\\b`, "gi");

// Tiret connecteur mid-phrase : mot [espace/tab horizontal] tiret [espace/tab]
// mot — tous sur la même ligne. Les bullets début de ligne (\n-) sont exclus
// parce qu'ils ne passent pas cette contrainte « pas de \n ».
const HYPHEN_CONNECTOR_RE = /\w+[ \t]+[-–—][ \t]+\w+/;

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Normalise les accents pour matcher robustement :
//   « cordialement » / « Cordialement » / « CORDIALEMENT »
//   « bien à vous » / « bien a vous » (accent pas toujours présent en DB)
function deaccent(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * @param {string} text
 * @param {object} personaVoice - persona.voice subobject (forbiddenWords, signaturePhrases, …)
 * @returns {{ score, signals, violations, reasons, shouldFlag }}
 */
export function evaluateVoice(text, personaVoice = {}) {
  if (!text) return { score: 1, signals: {}, violations: [], reasons: [], shouldFlag: false };

  const violations = [];
  const signals = {};
  const normText = deaccent(text);

  // V1 — forbiddenWords persona (match insensible aux accents et à la casse)
  const forbidden = (personaVoice.forbiddenWords || [])
    .map(w => deaccent(String(w).trim())).filter(Boolean);
  const forbiddenHits = forbidden.filter(w => {
    if (/\s/.test(w)) return normText.includes(w); // expression multi-mots
    return new RegExp(`\\b${escapeRe(w)}\\b`).test(normText);
  });
  signals.v_forbidden_count = forbiddenHits.length;
  signals.v_forbidden_hits = forbiddenHits.slice(0, 5);
  if (forbiddenHits.length) {
    violations.push({ id: "V1", weight: 1.0, reason: `mot interdit: ${forbiddenHits.slice(0, 3).join(", ")}` });
  }

  // V2 — verbe anglais conjugué
  const angMatches = text.match(ANGLICIZED_RE) || [];
  signals.v_anglicized_count = angMatches.length;
  signals.v_anglicized_hits = angMatches.slice(0, 3);
  if (angMatches.length) {
    violations.push({ id: "V2", weight: 1.0, reason: `verbe anglais conjugué: ${angMatches.slice(0, 2).join(", ")}` });
  }

  // V3 — tiret connecteur
  const hasHyphen = HYPHEN_CONNECTOR_RE.test(text);
  signals.v_has_hyphen_connector = hasHyphen;
  if (hasHyphen) {
    violations.push({ id: "V3", weight: 0.4, reason: "tirets liant deux idées (style IA)" });
  }

  // V4 — signaturePhrases (bonus info, pas de flag). Match insensible aux accents.
  const sigs = (personaVoice.signaturePhrases || []).map(s => deaccent(String(s)));
  const sigHits = sigs.filter(s => s && normText.includes(s));
  signals.v_signature_count = sigHits.length;

  const maxScore = 2.4; // V1 + V2 + V3
  const violationScore = violations.reduce((a, v) => a + v.weight, 0);
  const score = +(1 - violationScore / maxScore).toFixed(3);
  const reasons = violations.map(v => `${v.id}:${v.reason}`);
  const shouldFlag = violationScore > 0;

  return { score, signals, violations, reasons, shouldFlag };
}

// Parse une prose markdown de playbook source en "toggles virtuels".
// Convention détectée sur les 8 playbooks de Nicolas Lavallée :
//   ## 0. RÈGLES ABSOLUES POUR CE CANAL    (optionnel, spyer uniquement)
//   ## 1. ICEBREAKER — ...
//   ## 2. QUALIFIER LA RÉPONSE + SWOT / TOWS
//   ## 3. CREUSEMENT — ...
//   ## 4. PROPOSITION DE CALL — ...
//   ## 5. SORTIE PROPRE
//   ## 6. R1 RÉSERVÉ
//   ## 7. TRAITEMENT D'UNE RECO            (optionnel, premier_degre uniquement)
//
// V1.0 : pas de DB, on parse au render. Si la convention n'est pas suivie,
// fallback = un seul toggle "playbook entier" avec la prose intégrale.

const TOGGLE_HEADER = /^##\s+(\d+)\.\s+(.+?)\s*$/m;
const RULES_HEADER = /^###?\s+.*RÈGLES?\s+D['']OR.*$/im;

/**
 * @param {string} prose - markdown brut de la section playbook (kind='custom')
 * @returns {{ toggles: Array<{ idx: number, title: string, prose: string }>, goldenRules: string|null, parsed: boolean }}
 */
export function parsePlaybookProse(prose) {
  if (!prose || typeof prose !== "string") {
    return { toggles: [], goldenRules: null, parsed: false };
  }

  const lines = prose.split(/\r?\n/);
  const headers = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TOGGLE_HEADER);
    if (m) {
      headers.push({ line: i, idx: parseInt(m[1], 10), title: m[2].trim() });
    }
  }

  if (headers.length === 0) {
    return {
      toggles: [{ idx: 0, title: "Playbook complet", prose: prose.trim() }],
      goldenRules: null,
      parsed: false,
    };
  }

  // Découper la prose entre chaque header
  const toggles = headers.map((h, i) => {
    const startLine = h.line + 1;
    const endLine = i + 1 < headers.length ? headers[i + 1].line : lines.length;
    const body = lines.slice(startLine, endLine).join("\n").trim();
    return { idx: h.idx, title: h.title, prose: body };
  });

  // Le bloc règles d'or (s'il existe) est généralement APRÈS le dernier toggle,
  // soit sous "### RAPPEL — LES X RÈGLES D'OR..." soit juste "### RÈGLES D'OR".
  // On le détecte dans la prose intégrale et, si trouvé, on l'isole.
  let goldenRules = null;
  const rulesMatch = prose.match(/###?\s+(?:💡\s+)?(?:RAPPEL\s*—?\s*)?(?:LES?\s+)?\d*\s*RÈGLES?\s+D['']OR[^\n]*/i);
  if (rulesMatch) {
    const startIdx = rulesMatch.index + rulesMatch[0].length;
    // S'arrêter au prochain header de niveau ## ou ### si présent
    const after = prose.slice(startIdx);
    const stopMatch = after.match(/\n##\s+|\n###\s+(?!Règles?)/i);
    const block = stopMatch ? after.slice(0, stopMatch.index) : after;
    goldenRules = block.trim();
  }

  return { toggles, goldenRules, parsed: true };
}

/**
 * Mapping scenario_type → toggle index par défaut.
 * V1.0 : déduction crude. Le setter peut override en cliquant un autre toggle.
 *
 * @param {string|null} scenarioType - DM_1st | DM_relance | DM_reply | DM_closing | null
 * @param {Array<{ idx: number }>} availableToggles - toggles parsés depuis la prose
 * @returns {number|null} - idx du toggle par défaut, ou null si pas de match
 */
export function defaultToggleForScenario(scenarioType, availableToggles) {
  if (!availableToggles || availableToggles.length === 0) return null;
  const has = (idx) => availableToggles.some((t) => t.idx === idx);

  switch (scenarioType) {
    case "DM_1st":
      return has(1) ? 1 : availableToggles[0].idx;
    case "DM_relance":
      return has(1) ? 1 : availableToggles[0].idx;
    case "DM_reply":
      // Default = T2 Qualif (le setter analyse). S'il manque, fallback T3 puis T1.
      if (has(2)) return 2;
      if (has(3)) return 3;
      return has(1) ? 1 : availableToggles[0].idx;
    case "DM_closing":
      if (has(4)) return 4;
      if (has(6)) return 6;
      return availableToggles[availableToggles.length - 1].idx;
    default:
      return availableToggles[0].idx;
  }
}

/**
 * Court label affiché dans la mini-timeline.
 * Garde le numéro + un mot-clé court extrait du titre.
 */
export function shortLabelForToggle(toggle) {
  const title = toggle.title || "";
  // Extraire le 1er mot significatif (ignorer "—", "DE", "LA", etc.)
  const firstWord = title.split(/[\s—-]+/).find((w) => w.length >= 3 && !/^(DE|LA|LE|LES|UN|UNE|DU|DES)$/i.test(w));
  return firstWord ? firstWord.toLowerCase() : `T${toggle.idx}`;
}

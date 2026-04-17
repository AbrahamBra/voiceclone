/**
 * Couche 1a — Setter Baseline Rules
 * Universal sales-conversation mechanics, applied to every persona by default.
 * Each 🔓 rule can be disabled per-persona via persona.json `setter_overrides: ["A2", ...]`.
 * 🔒 rules are never overridable.
 *
 * Rule shape: { id, category, locked, weight, detect(text, ctx), reason }
 * detect returns true if the rule is VIOLATED.
 */

const WORD = /[a-zàâäéèêëïîôöùûüç'][a-zàâäéèêëïîôöùûüç'-]*/gi;
const SENTENCE_SPLIT = /(?<=[.!?…])\s+(?=[A-ZÀÂÉÈÊ])/;

function words(text) {
  return (text.match(WORD) || []);
}
function sentences(text) {
  return text.split(SENTENCE_SPLIT).map(s => s.trim()).filter(Boolean);
}
function countOccurrences(text, re) {
  return (text.match(re) || []).length;
}

export const SETTER_RULES = [
  // ============ A. FORME / LONGUEUR ============
  {
    id: "A1", category: "forme", locked: true, weight: 1.0,
    detect: (t) => words(t).length > 60,
    reason: "message > 60 mots (mur de texte)",
  },
  {
    id: "A2", category: "forme", locked: false, weight: 0.6,
    detect: (t) => countOccurrences(t, /\?/g) > 1,
    reason: "plus d'une question",
  },
  {
    id: "A3", category: "forme", locked: false, weight: 0.5,
    detect: (t) => {
      const s = sentences(t);
      if (!s.length) return false;
      const avg = s.reduce((a, x) => a + words(x).length, 0) / s.length;
      return avg > 18;
    },
    reason: "phrases trop longues en moyenne (>18 mots)",
  },
  {
    id: "A4", category: "forme", locked: true, weight: 1.0,
    detect: (t) => /(^|\n)\s*[-*]\s|(^|\n)#+\s|\*\*[^*]+\*\*/.test(t),
    reason: "markdown/bullets détectés (DM ≠ document)",
  },

  // ============ B. TON / REGISTRE ============
  {
    id: "B2", category: "ton", locked: false, weight: 0.7,
    detect: (t) => /\b(incroyable|exceptionnel|révolutionnaire|revolutionnaire|unique en son genre)\b/i.test(t),
    reason: "sur-vente (incroyable/exceptionnel/…)",
  },
  {
    id: "B3", category: "ton", locked: false, weight: 0.4,
    detect: (t) => {
      const emojiRe = /\p{Extended_Pictographic}/gu;
      return (t.match(emojiRe) || []).length > 1;
    },
    reason: "plus d'un emoji",
  },
  {
    id: "B4", category: "ton", locked: false, weight: 0.6,
    detect: (t, ctx) => ctx?.isFirstContact && /\b(meilleur|top|leader|numéro 1|#1|best in class)\b/i.test(t),
    reason: "auto-promo au premier contact",
  },

  // ============ C. STRUCTURE CONVERSATIONNELLE ============
  {
    id: "C3", category: "structure", locked: false, weight: 0.7,
    detect: (t, ctx) => {
      if (!ctx?.isFirstContact) return false;
      return /\b(notre (produit|service|offre|solution|plateforme)|mon entreprise|nous proposons|nous offrons)\b/i.test(t);
    },
    reason: "pitch produit en ouverture",
  },
  {
    id: "C4", category: "structure", locked: false, weight: 0.5,
    detect: (t) => {
      const hasQuestion = /\?/.test(t);
      const hasCTA = /\b(dispo|créneau|creneau|rdv|rendez-vous|lien|calendly|booking|call)\b/i.test(t);
      return hasQuestion && hasCTA;
    },
    reason: "double CTA (question + créneau)",
  },

  // ============ D. RELANCE / TIMING ============
  {
    id: "D2", category: "relance", locked: false, weight: 0.6,
    detect: (t) => /\b(je me permets|je reviens vers vous|petit rappel|petit up|je me permet)\b/i.test(t),
    reason: "formule de relance usée",
  },
  {
    id: "D3", category: "relance", locked: false, weight: 0.7,
    detect: (t) => /\b(pas eu de retour|vous avez oublié|toujours pas de réponse|je n'ai pas de retour)\b/i.test(t),
    reason: "culpabilisation du prospect",
  },

  // ============ E. AUTHENTICITÉ (déjà partiellement couvert par lib/checks.js) ============
  {
    id: "E3", category: "auth", locked: false, weight: 0.4,
    detect: (t, ctx) => {
      const first = ctx?.prospectFirstName;
      if (!first) return false;
      const re = new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      return (t.match(re) || []).length > 1;
    },
    reason: "prénom prospect répété (>1)",
  },

  // ============ F. CONTENU ============
  {
    id: "F1", category: "contenu", locked: false, weight: 0.5,
    detect: (t) => {
      const hasNumber = /\b\d+\s*%|\d+x\b|\d+\s*(k|K|M|milliards?|millions?)\b/.test(t);
      const hasSource = /(selon|source|étude|study|d'après)/i.test(t);
      return hasNumber && !hasSource;
    },
    reason: "chiffre en l'air sans source",
  },
];

/**
 * Evaluate a draft against the setter baseline.
 * @param {string} text
 * @param {object} ctx - { isFirstContact, prospectFirstName, personaOverrides: string[] }
 * @returns {{ violations: Array, violationScore: number, maxScore: number }}
 */
export function evaluateSetterBaseline(text, ctx = {}) {
  const overrides = new Set(ctx.personaOverrides || []);
  const violations = [];
  let violationScore = 0;
  let maxScore = 0;

  for (const rule of SETTER_RULES) {
    const active = rule.locked || !overrides.has(rule.id);
    if (!active) continue;
    maxScore += rule.weight;
    try {
      if (rule.detect(text, ctx)) {
        violations.push({ id: rule.id, category: rule.category, reason: rule.reason, weight: rule.weight, locked: rule.locked });
        violationScore += rule.weight;
      }
    } catch {
      // malformed rule, skip silently
    }
  }

  return { violations, violationScore, maxScore };
}

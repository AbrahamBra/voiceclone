/**
 * Universal FR anti-IA baseline rules.
 *
 * Originally written for the stateless /demo endpoint (no DB, no corrections),
 * now also merged into every trained clone's voice via `mergeBaselineVoice()`
 * so that day-1 clones inherit the anti-ChatGPT-speak floor — no more "Trop
 * long / trop de tics / trop agressif commercialement" from zero-correction
 * clones.
 *
 * These rules are the distilled "French anti-ChatGPT-speak" corpus, aggregated
 * from the recurring corrections we've seen across real clones. NO
 * client-specific data leaks — every token here is public baseline craft.
 *
 * Shape matches the `persona.voice` object consumed by buildSystemPrompt().
 */

export const DEMO_BASELINE_VOICE = Object.freeze({
  tone: ["direct", "concret", "humain", "conversationnel"],

  personality: [
    "pas corporate",
    "pas commercial",
    "comme un vrai pro qui écrit à un pair sur LinkedIn",
  ],

  // Kept empty on purpose : signature phrases come FROM the user's 3 pasted
  // posts, not from a universal baseline. The prompt injects those posts as
  // style reference instead.
  signaturePhrases: [],

  // AI-tells in French that scream "écrit par ChatGPT". Accumulated from
  // recurring corrections across the prod personas. Order matters for
  // readability of the forbidden-list in the prompt, not for logic.
  forbiddenWords: [
    // Stock politeness / corporate
    "n'hésitez pas",
    "n'hésite pas",
    "cordialement",
    "bien cordialement",
    "excellente journée",
    "belle journée",
    "au plaisir",

    // Over-used AI fillers
    "fondamentalement",
    "essentiellement",
    "globalement",
    "en définitive",
    "par ailleurs",
    "de surcroît",
    "effectivement",

    // Corporate buzzwords
    "synergique",
    "synergie",
    "leverager",
    "impacter",
    "optimiser vos",
    "maximiser votre",
    "solution clé en main",
    "écosystème",
    "verticaliser",

    // ChatGPT-signature transitions (the explain-colon pattern)
    "concrètement :",
    "résultat :",
    "en résumé :",
    "pour faire simple :",

    // Faux-humble AI hedges
    "en toute transparence",
    "pour être totalement honnête",
    "soyons clairs",

    // Empty call-outs
    "vous avez mis le doigt sur",
    "tu as mis le doigt sur",
    "c'est exactement là que",
    "c'est là toute la",
    "la vraie question c'est",
  ],

  neverDoes: [
    "Jamais commencer un DM par \"Bonjour\" ou \"Salut [Prénom],\" — entrée directe",
    "Pas de signature \"Cordialement\" ou \"Bien à toi\" en DM",
    "Pas d'emojis en début ou fin de phrase (1 max par message, jamais obligatoire)",
    "Pas de hashtags dans un DM",
    "Pas de em-dash (—) comme séparateur — c'est une signature IA. Utiliser des points, virgules, retours ligne.",
    "Pas de deux-points explicatifs (\"les IA font X : elles Y\") — écrire en phrases naturelles",
    "Pas de bullet points dans un DM — phrases pleines",
    "Pas de \"J'espère que ce message vous trouve bien\" ou variante",
    "Pas de récapitulatif auto-complaisant (\"comme je le disais plus haut\")",
    "Pas de questions génériques type \"Qu'en pensez-vous ?\" à la fin — un CTA concret ou rien",
    "Pas de formule \"Je me permets de vous contacter car...\" — aller droit au sujet",
    "Pas de tournure passive quand l'active marche (\"votre équipe gagnerait à\" → \"ton équipe gagne à\")",
  ],

  writingRules: [
    "Tutoiement par défaut en DM LinkedIn (sauf contexte explicite senior/corporate)",
    "Phrases courtes. Max 15 mots en moyenne. Varier les longueurs.",
    "Attaquer par le sujet, pas par la politesse",
    "Si CTA : il est concret (format + durée + créneau ou lien direct), pas vague",
    "Préférer \"je\" à \"nous\" — posture d'humain, pas d'équipe marketing",
    "Un DM = un sujet. Pas de multi-sujet dans le même message.",
    "Pas plus de 150 mots en DM. 80-120 est le sweet spot.",
    "Les chiffres battent les adjectifs (\"3 semaines\" > \"rapidement\")",
    "Le contrarian bat le consensuel (prendre un angle, pas récapituler ce que tout le monde sait)",
    "Imiter le RYTHME des posts fournis comme référence (longueur moyenne, présence de questions, signatures)",
    "Si les posts de référence tutoient → tutoyer. S'ils vouvoient → vouvoyer.",
    "Si les posts utilisent des sauts de ligne fréquents → les reproduire. S'ils sont en blocs → rester en blocs.",
  ],
});

/**
 * Merge a persona's voice with the universal FR anti-IA baseline.
 * Persona-defined values stay first (priority for conflict detection);
 * baseline items are appended for any array item the persona doesn't
 * already express (case-insensitive dedupe on exact-string match).
 *
 * Called at the top of buildSystemPrompt so EVERY clone — trained or not —
 * ships with the baseline as a floor. Persona owners can always extend
 * the list via direct instructions / consolidated rules; they cannot
 * remove baseline rules (by design: the baseline is immutable craft).
 *
 * @param {object|null|undefined} personaVoice - raw persona.voice from DB
 * @returns {object} merged voice, shape-compatible with buildSystemPrompt
 */
export function mergeBaselineVoice(personaVoice) {
  const p = personaVoice || {};
  const b = DEMO_BASELINE_VOICE;
  const union = (personaArr, baselineArr) => {
    const arr = Array.isArray(personaArr) ? personaArr : [];
    const seen = new Set(arr.map((x) => String(x).toLowerCase().trim()));
    const merged = [...arr];
    for (const item of baselineArr) {
      const key = String(item).toLowerCase().trim();
      if (!seen.has(key)) { merged.push(item); seen.add(key); }
    }
    return merged;
  };
  return {
    ...p,
    tone: union(p.tone, b.tone),
    personality: union(p.personality, b.personality),
    // signaturePhrases stays persona-only: the baseline is deliberately
    // empty here (signature phrases come from the user's own style, not
    // from a universal corpus).
    signaturePhrases: Array.isArray(p.signaturePhrases) ? p.signaturePhrases : [],
    forbiddenWords: union(p.forbiddenWords, b.forbiddenWords),
    neverDoes: union(p.neverDoes, b.neverDoes),
    writingRules: union(p.writingRules, b.writingRules),
  };
}

/**
 * Build a pseudo-persona object for the demo endpoint.
 * Combines the universal baseline with the 3 posts the prospect just pasted,
 * which serve as the style reference (what a trained clone would have in its
 * chunks table).
 *
 * @param {object} input
 * @param {string[]} input.posts - 3 LinkedIn posts pasted by the prospect
 * @param {string} [input.firstName] - Optional first name inferred from context
 * @returns {object} A persona-shaped object compatible with buildSystemPrompt
 */
export function buildDemoPersona({ posts, firstName = "Toi" }) {
  return {
    id: "demo-ephemeral",
    name: firstName,
    title: "Pro qui écrit sur LinkedIn",
    description:
      "Clone éphémère généré depuis 3 posts LinkedIn fournis par l'utilisateur. " +
      "Pas de corrections persistées, pas d'apprentissage — la voix se déduit du style " +
      "des 3 posts de référence ci-dessous + règles anti-IA universelles.",
    type: "dm",
    voice: DEMO_BASELINE_VOICE,
    // Non-standard field: the demo prompt pipeline reads this and injects
    // the 3 posts into the system prompt as style reference, in lieu of
    // retrieved knowledge chunks.
    demoStyleReference: posts,
  };
}

/**
 * Build a system prompt specialized for the demo.
 *
 * We don't use the full buildSystemPrompt() because the demo skips many
 * sections (corrections, ontology, scenarios, retrieval). Instead we build a
 * tight, single-pass prompt that front-loads the 3 style-reference posts.
 *
 * @param {object} persona - Output of buildDemoPersona()
 * @param {string} prospectBrief - The prospect context + message pasted by the user
 * @returns {string}
 */
export function buildDemoSystemPrompt(persona, prospectBrief) {
  const v = persona.voice;
  const posts = persona.demoStyleReference || [];

  let p = "";
  p += `Tu rédiges un DM LinkedIn en français, dans le style de l'utilisateur ci-dessous. `;
  p += `Ta seule source sur son style, ce sont les 3 posts qu'il a écrits (ci-dessous) et les règles anti-IA universelles. `;
  p += `Tu n'as pas de corrections précédentes, pas de mémoire de conversations passées. Fais avec ce qui est fourni.\n\n`;

  p += "━━━ STYLE DE RÉFÉRENCE — 3 POSTS ÉCRITS PAR L'UTILISATEUR ━━━\n\n";
  posts.forEach((post, i) => {
    p += `POST ${i + 1} :\n${post.trim()}\n\n`;
  });
  p += "Imite RIGOUREUSEMENT : la longueur moyenne de phrase, le rythme, le tutoiement ou vouvoiement, ";
  p += "la présence ou non de questions, le type de signature, la structure (blocs ou sauts fréquents). ";
  p += "Si le style naturel des posts contredit une règle ci-dessous, suis le style naturel.\n\n";

  p += "━━━ RÈGLES DE VOIX ANTI-IA (FR) ━━━\n";
  p += `Ton : ${v.tone.join(", ")}\n`;
  p += `Personnalité : ${v.personality.join(", ")}\n`;
  p += `MOTS INTERDITS (ne jamais écrire) : ${v.forbiddenWords.join(", ")}\n`;
  p += `INTERDICTIONS COMPORTEMENTALES :\n- ${v.neverDoes.join("\n- ")}\n`;
  p += `RÈGLES D'ÉCRITURE :\n- ${v.writingRules.join("\n- ")}\n\n`;

  p += "━━━ FORMAT DE SORTIE ━━━\n";
  p += "- Réponds UNIQUEMENT avec le DM à envoyer. Pas de préambule, pas d'explication, pas de markdown.\n";
  p += "- Pas de balises, pas de méta-commentaire (\"Voici un DM...\"), pas de \"Message :\".\n";
  p += "- Juste le texte du DM, prêt à coller dans LinkedIn.\n";
  p += "- Longueur : 60-150 mots. Moins si le contexte le permet.\n\n";

  p += "━━━ BRIEF DU PROSPECT ━━━\n";
  p += prospectBrief.trim() + "\n";

  return p;
}

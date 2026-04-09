// ============================================================
// EVAL CHECKS — Programmatic assertions for voice clone fidelity
// ============================================================

// --- Forbidden words from voice-dna.json words_to_avoid ---
const FORBIDDEN_WORDS = [
  "disruptif", "game changer", "je suis ravi", "n'hesitez pas", "n'hésitez pas",
  "dans un monde en constante evolution", "dans un monde en constante évolution",
  "tips", "astuces", "hacks", "mindset", "passer au next level",
  "booster", "exploser les compteurs", "authenticité", "authenticite",
];

// --- Forbidden phrases from voice-dna.json never_say.phrases ---
const FORBIDDEN_PHRASES = [
  "je suis ravi de partager", "en conclusion", "cher reseau", "cher réseau",
  "force a toi", "force à toi", "j'ai l'honneur", "ca va changer ta vie",
  "ça va changer ta vie", "le secret c'est",
];

// --- AI patterns from humanizer-rules.md (hardcoded, not parsed) ---
const AI_PATTERNS = [
  // Words
  "crucial", "essentiel", "fondamental", "permettre de", "il est important de noter",
  "en effet", "par conséquent", "par consequent", "néanmoins", "neanmoins",
  "au sein de", "mettre en place", "grâce à", "grace a", "afin de",
  "optimiser", "maximiser", "leverager", "je me permets de",
  // Structural patterns
  "non seulement", "par ailleurs", "de plus", "en outre",
  "dans un monde où", "dans un monde ou", "à l'ère de", "a l'ere de",
];

// --- Motivational cliches from voice-dna.json never_say.tones ---
const MOTIVATIONAL_PATTERNS = [
  "tu vaux mieux que", "crois en toi", "force a toi", "force à toi",
  "ca va changer ta vie", "ça va changer ta vie", "hustle", "grind",
  "tu peux tout faire", "rien n'est impossible", "sors de ta zone de confort",
];

// --- Implicit criticism patterns from corrections.md ---
const IMPLICIT_CRITICISM = [
  "je ne vois rien", "vous ne montrez pas", "il manque",
  "votre profil ne mentionne pas", "rien n'indique que",
  "vous ne semblez pas", "on ne voit pas",
];

// --- Accusatory question patterns ---
const ACCUSATORY_QUESTIONS = [
  "non ?", "n'est-ce pas ?", "vous n'y avez pas pensé",
  "c'est pourtant déterminant", "c'est pourtant determinant",
];

// --- Self-reveal patterns ---
const SELF_REVEAL = [
  "je suis une ia", "je suis une intelligence artificielle",
  "intelligence artificielle", "modèle de langage", "modele de langage",
  "en tant qu'ia", "en tant qu'intelligence artificielle",
  "je suis un assistant", "je suis un chatbot",
];

// --- Prompt leak fragments ---
const PROMPT_LEAK = [
  "regles humanizer", "règles humanizer", "instruction scenario",
  "instruction scénario", "base de connaissance", "corrections & apprentissages",
  "instruction d'identite", "instruction d'identité",
  "systeme interne", "système interne", "autocritique",
];

// --- Emoji regex ---
const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

// ============================================================
// CHECK FUNCTIONS
// Each returns { pass: boolean, detail?: string }
// ============================================================

function normalize(text) {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function noForbiddenWords(response) {
  const text = normalize(response);
  for (const word of FORBIDDEN_WORDS) {
    if (text.includes(normalize(word))) {
      return { pass: false, detail: `found "${word}"` };
    }
  }
  for (const phrase of FORBIDDEN_PHRASES) {
    if (text.includes(normalize(phrase))) {
      return { pass: false, detail: `found "${phrase}"` };
    }
  }
  return { pass: true };
}

export function noAIPatterns(response) {
  const text = normalize(response);
  for (const pattern of AI_PATTERNS) {
    if (text.includes(normalize(pattern))) {
      return { pass: false, detail: `found AI pattern "${pattern}"` };
    }
  }
  return { pass: true };
}

export function noExclamation(response) {
  if (response.includes("!")) {
    return { pass: false, detail: `found "!" in response` };
  }
  return { pass: true };
}

export function noEmoji(response, params) {
  let text = response;
  // In analyze scenario, strip <analysis> block (score emoji allowed there)
  if (params?.allowAnalysisEmoji) {
    text = text.replace(/<analysis>[\s\S]*?<\/analysis>/g, "");
  }
  const matches = text.match(EMOJI_REGEX);
  if (matches && matches.length > 0) {
    return { pass: false, detail: `found emoji: ${matches.slice(0, 3).join(", ")}` };
  }
  return { pass: true };
}

export function maxLength(response, params) {
  if (response.length > params.value) {
    return { pass: false, detail: `${response.length} chars (max ${params.value})` };
  }
  return { pass: true };
}

export function minLength(response, params) {
  if (response.length < params.value) {
    return { pass: false, detail: `${response.length} chars (min ${params.value})` };
  }
  return { pass: true };
}

export function containsQuestion(response) {
  if (!response.includes("?")) {
    return { pass: false, detail: `no "?" found` };
  }
  return { pass: true };
}

export function vouvoiement(response) {
  // Extract <dm> block if present, otherwise check full response
  const dmMatch = response.match(/<dm>([\s\S]*?)<\/dm>/);
  const text = dmMatch ? dmMatch[1] : response;
  const lower = text.toLowerCase();

  // Check for tutoiement markers (but not inside words like "tuteur")
  const tuPatterns = [/\btu\b/, /\bton\b/, /\bta\b/, /\btes\b/, /\btoi\b/];
  for (const pat of tuPatterns) {
    if (pat.test(lower)) {
      return { pass: false, detail: `found tutoiement in DM` };
    }
  }
  return { pass: true };
}

export function noImplicitCriticism(response) {
  const text = normalize(response);
  for (const phrase of IMPLICIT_CRITICISM) {
    if (text.includes(normalize(phrase))) {
      return { pass: false, detail: `found implicit criticism: "${phrase}"` };
    }
  }
  return { pass: true };
}

export function noAccusatoryQuestion(response) {
  const text = normalize(response);
  for (const phrase of ACCUSATORY_QUESTIONS) {
    if (text.includes(normalize(phrase))) {
      return { pass: false, detail: `found accusatory question: "${phrase}"` };
    }
  }
  return { pass: true };
}

export function containsTag(response, params) {
  if (!response.includes(params.value)) {
    return { pass: false, detail: `missing tag ${params.value}` };
  }
  return { pass: true };
}

export function noSelfReveal(response) {
  const text = normalize(response);
  for (const phrase of SELF_REVEAL) {
    if (text.includes(normalize(phrase))) {
      return { pass: false, detail: `found self-reveal: "${phrase}"` };
    }
  }
  return { pass: true };
}

export function noPromptLeak(response) {
  const text = normalize(response);
  for (const fragment of PROMPT_LEAK) {
    if (text.includes(normalize(fragment))) {
      return { pass: false, detail: `found prompt leak: "${fragment}"` };
    }
  }
  return { pass: true };
}

export function noMotivationalPatterns(response) {
  const text = normalize(response);
  for (const phrase of MOTIVATIONAL_PATTERNS) {
    if (text.includes(normalize(phrase))) {
      return { pass: false, detail: `found motivational cliche: "${phrase}"` };
    }
  }
  return { pass: true };
}

// ============================================================
// CHECK REGISTRY
// ============================================================

export const CHECKS = {
  noForbiddenWords,
  noAIPatterns,
  noExclamation,
  noEmoji,
  maxLength,
  minLength,
  containsQuestion,
  vouvoiement,
  noImplicitCriticism,
  noAccusatoryQuestion,
  containsTag,
  noSelfReveal,
  noPromptLeak,
  noMotivationalPatterns,
};

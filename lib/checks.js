/**
 * Programmatic quality checks — deterministic, instant (~0ms).
 * Replaces Haiku-based scoring for real-time pipeline.
 */

const SELF_REVEAL = /je suis (une? )?i\.?a\.?|language model|en tant qu'assistant|artificial intelligence|intelligence artificielle|modele de langage/i;
const PROMPT_LEAK = /mes instructions|system prompt|mon role|mes regles|ma configuration|je suis programme|^#\s*(?:Tu es|Scenario|REGLES|INSTRUCTIONS)/mi;
const AI_CLICHES = /\b(crucial|essentiel|il est important de noter|permettre de|n'hesitez pas|je comprends votre|en conclusion|il convient de|il est a noter|fondamentalement|indeniablement)\b/i;
const MARKDOWN_PATTERNS = /\*\*[^*]+\*\*|^#+\s|^[-*]\s/m;

/**
 * Run all checks against a generated response.
 * @param {string} text - Generated response text
 * @param {object} voiceRules - { forbiddenWords, writingRules, neverDoes, signaturePhrases }
 * @returns {{ violations: Array<{type: string, severity: string, detail: string}>, passed: boolean, shouldRewrite: boolean }}
 */
export function checkResponse(text, voiceRules) {
  const violations = [];
  const lower = text.toLowerCase();

  // --- HARD violations (trigger rewrite) ---

  // Forbidden words
  if (voiceRules.forbiddenWords?.length) {
    for (const word of voiceRules.forbiddenWords) {
      const w = word.toLowerCase().trim();
      if (w && lower.includes(w)) {
        violations.push({ type: "forbidden_word", severity: "hard", detail: word });
      }
    }
  }

  // Self-reveal
  if (SELF_REVEAL.test(text)) {
    violations.push({ type: "self_reveal", severity: "hard", detail: text.match(SELF_REVEAL)?.[0] });
  }

  // Prompt leak
  if (PROMPT_LEAK.test(text)) {
    violations.push({ type: "prompt_leak", severity: "hard", detail: text.match(PROMPT_LEAK)?.[0] });
  }

  // --- STRONG violations (flag, no rewrite) ---

  // AI clichés
  if (AI_CLICHES.test(text)) {
    const match = text.match(AI_CLICHES);
    violations.push({ type: "ai_cliche", severity: "strong", detail: match?.[0] });
  }

  // Markdown in response
  if (MARKDOWN_PATTERNS.test(text)) {
    violations.push({ type: "markdown", severity: "strong", detail: "Markdown detecte dans la reponse" });
  }

  // Excessive length (if writing rules mention short/court)
  const hasShortRule = voiceRules.writingRules?.some(r =>
    /court|bref|concis|5-15 mots|ultra.?court/i.test(r)
  );
  if (hasShortRule && text.length > 300) {
    violations.push({ type: "too_long", severity: "strong", detail: `${text.length} chars (regles: messages courts)` });
  }

  // --- LIGHT violations (info only) ---

  // No signature phrases used (on longer messages)
  if (text.length > 100 && voiceRules.signaturePhrases?.length) {
    const hasAny = voiceRules.signaturePhrases.some(p =>
      lower.includes(p.toLowerCase())
    );
    if (!hasAny) {
      violations.push({ type: "no_signature", severity: "light", detail: "Aucune expression signature utilisee" });
    }
  }

  const hasHard = violations.some(v => v.severity === "hard");

  return {
    violations,
    passed: !hasHard,
    shouldRewrite: hasHard,
  };
}

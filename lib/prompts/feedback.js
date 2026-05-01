// System prompts + tool schemas for /api/feedback. Extracted from
// api/feedback.js so prompt edits don't touch route logic and can be
// reviewed/versioned independently.
//
// Migration 056-era refacto: les 3 endroits qui parsaient du JSON via regex
// (`raw.match(/\{[\s\S]*\}/)`) utilisent maintenant tool_use avec un schéma
// strict. Mirrors le pattern de lib/protocol-parser.js et
// lib/graph-extraction-file.js.

export function regenerateSystem(voiceContext) {
  return `Tu es un assistant qui reecrit des messages. ${voiceContext}`;
}

export const EXTRACT_RULE_SYSTEM = `Extrais la regle/instruction de ce message utilisateur. Appelle l'outil emit_rule avec une description concise et actionnable. Si le message ne contient pas de regle claire, appelle emit_rule avec rule=null.`;

export const EXTRACT_RULES_FROM_POST_SYSTEM = `Tu analyses un post LinkedIn écrit à la main par un client (ghostwriter). Extrais 3 à 5 règles de style/voix actionnables qui caractérisent SA façon d'écrire. Chaque règle doit être concrète et réutilisable pour guider un futur draft. Évite les règles génériques ("sois authentique"). Privilégie : tournures, structures, ouvertures/closings, tics, longueurs, ponctuation, ton.

Appelle l'outil emit_rules avec les règles détectées. Si le post est trop générique pour en extraire, appelle emit_rules avec rules=[].`;

export const IMPLICIT_DIFF_SYSTEM = `Compare ces deux versions d'un message. Decris en 1-2 phrases les modifications de style effectuees par l'utilisateur. Sois concis et actionnable.`;

// ── Tool schemas ────────────────────────────────────────────
// Used with tool_choice: { type: "tool", name: "..." } to force a structured
// JSON response instead of free-text we'd parse with a regex.

export const REGENERATE_TOOL = {
  name: "emit_alternatives",
  description: "Emit exactly 2 rewritten alternatives that fix the issue raised by the user.",
  input_schema: {
    type: "object",
    properties: {
      alternatives: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 2,
        description: "Two distinct rewrites of the original message that address the user's correction.",
      },
    },
    required: ["alternatives"],
  },
};

export const EXTRACT_RULE_TOOL = {
  name: "emit_rule",
  description: "Emit the actionable rule extracted from the user message. rule=null if no clear rule.",
  input_schema: {
    type: "object",
    properties: {
      rule: {
        anyOf: [{ type: "string" }, { type: "null" }],
        description: "Concise actionable rule (≤ 300 chars), or null if no rule.",
      },
    },
    required: ["rule"],
  },
};

export const EXTRACT_RULES_FROM_POST_TOOL = {
  name: "emit_rules",
  description: "Emit 3-5 voice/style rules extracted from a hand-written post. Empty array if too generic.",
  input_schema: {
    type: "object",
    properties: {
      rules: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "Concise actionable rule (≤ 300 chars)." },
            rationale: { type: "string", description: "Specific quote/example from the post that illustrates the rule (≤ 200 chars)." },
          },
          required: ["text"],
        },
        maxItems: 5,
      },
    },
    required: ["rules"],
  },
};

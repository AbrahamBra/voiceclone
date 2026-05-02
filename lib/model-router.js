/**
 * Multi-model routing — pick Haiku or Sonnet based on conversation complexity.
 *
 * Complexity signals:
 * - Knowledge matches present → complex (domain-specific response needed)
 * - Ontology entities matched → complex (conceptual reasoning)
 * - Long user message → complex (detailed question)
 * - Active corrections count → complex (many style constraints)
 *
 * Haiku handles: casual chat, short greetings, simple questions.
 * Sonnet handles: knowledge-grounded responses, complex scenarios, high-correction personas.
 */

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

// Threshold: score >= this → Sonnet, below → Haiku
const COMPLEXITY_THRESHOLD = 3;

/**
 * Score conversation complexity and return the appropriate model.
 * @param {object} params
 * @param {string} params.message - Current user message
 * @param {Array} params.knowledgeMatches - RAG results
 * @param {object} params.ontology - { directCount, entities }
 * @param {string|null} params.corrections - Formatted corrections string
 * @param {string} params.scenario - Current scenario slug
 * @returns {{ model: string, score: number, reason: string }}
 */
export function selectModel({ message, knowledgeMatches, ontology, corrections, scenario }) {
  let score = 0;
  const reasons = [];

  // Knowledge matches → domain expertise needed
  if (knowledgeMatches?.length > 0) {
    score += 2;
    reasons.push(`knowledge:${knowledgeMatches.length}`);
  }

  // Ontology entities matched → conceptual density
  if (ontology?.directCount > 2) {
    score += 2;
    reasons.push(`entities:${ontology.directCount}`);
  } else if (ontology?.directCount > 0) {
    score += 1;
    reasons.push(`entities:${ontology.directCount}`);
  }

  // Long message → detailed question
  if (message?.length > 300) {
    score += 1;
    reasons.push("long_msg");
  }

  // Complex scenarios
  if (scenario === "qualification") {
    score += 2;
    reasons.push(`scenario:${scenario}`);
  }

  // Many active corrections → needs precise style control
  if (corrections && corrections.split("\n").filter(l => l.startsWith("- **")).length > 15) {
    score += 1;
    reasons.push("many_corrections");
  }

  const model = score >= COMPLEXITY_THRESHOLD ? SONNET_MODEL : HAIKU_MODEL;

  return { model, score, reason: reasons.join(",") || "simple_chat" };
}

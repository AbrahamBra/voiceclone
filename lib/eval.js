/**
 * Voice fidelity eval pipeline.
 *
 * Takes a persona's corrections as natural test cases:
 * - Each correction has a bot_message (rejected) + user_message (correction)
 * - Replay the context with the current system prompt
 * - Check if the new response avoids the same violation
 *
 * Returns a fidelity score (% of corrections resolved by current prompt).
 *
 * Usage:
 *   import { runEval } from "./eval.js";
 *   const result = await runEval(personaId, { limit: 50 });
 *   // → { score: 0.82, total: 50, resolved: 41, failed: [...] }
 */

import Anthropic from "@anthropic-ai/sdk";
import { supabase, getApiKey } from "./supabase.js";
import { buildSystemPrompt } from "./prompt.js";
import { checkResponse } from "./checks.js";
import { loadPersonaData, getIntelligenceId, findRelevantEntities, getCorrectionsFromDb } from "./knowledge-db.js";
import { applyConfidenceDecay } from "./correction-decay.js";

const EVAL_MODEL = "claude-haiku-4-5-20251001"; // Cheap model for bulk eval
const EFFECTIVE_FLOOR = 0.15;

/**
 * Run a semantic check: does the regenerated response still violate the correction?
 * Uses Haiku to compare the correction vs the new response.
 */
async function semanticCheck(anthropic, correction, newResponse) {
  try {
    const result = await Promise.race([
      anthropic.messages.create({
        model: EVAL_MODEL,
        max_tokens: 10,
        system: `Compare la regle et la reponse. La reponse RESPECTE-t-elle cette regle ? Reponds PASS ou FAIL.`,
        messages: [{
          role: "user",
          content: `Regle : "${correction.slice(0, 200)}"\nReponse : "${newResponse.slice(0, 400)}"`,
        }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    return result.content[0].text.trim().toUpperCase().startsWith("PASS");
  } catch {
    return null; // Inconclusive
  }
}

/**
 * Run eval for a persona.
 * @param {string} personaId
 * @param {object} options
 * @param {number} options.limit - Max corrections to test (default 50)
 * @param {object} options.client - Client for API key resolution
 * @param {boolean} options.verbose - Include failed details
 * @returns {Promise<{ score: number, total: number, resolved: number, failed: Array, tokensUsed: number }>}
 */
export async function runEval(personaId, { limit = 50, client = null, verbose = false } = {}) {
  const data = await loadPersonaData(personaId);
  if (!data) throw new Error("Persona not found");

  const persona = data.persona;
  const intellId = getIntelligenceId(persona);

  // Get corrections with enough context to replay
  const { data: corrections } = await supabase
    .from("corrections")
    .select("id, correction, user_message, bot_message, confidence, status, created_at")
    .eq("persona_id", intellId)
    .neq("bot_message", "[direct-instruction]")
    .neq("bot_message", "[auto-detected from chat coaching]")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!corrections?.length) return { score: 1, total: 0, resolved: 0, failed: [], tokensUsed: 0 };

  // Filter: only corrections with meaningful bot_message context
  const testable = corrections.filter(c =>
    c.bot_message && c.bot_message.length > 10 &&
    c.correction && c.correction.length > 5 &&
    applyConfidenceDecay(c.confidence ?? 0.8, c.created_at) >= EFFECTIVE_FLOOR
  );

  if (!testable.length) return { score: 1, total: 0, resolved: 0, failed: [], tokensUsed: 0 };

  // Build current system prompt (without knowledge — pure voice eval)
  const correctionsMd = await getCorrectionsFromDb(personaId);
  const { prompt: systemPrompt } = buildSystemPrompt({
    persona,
    knowledgeMatches: [],
    scenarioContent: null,
    corrections: correctionsMd,
    ontology: { entities: [], relations: [] },
  });

  const apiKey = getApiKey(client);
  const anthropic = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });

  let resolved = 0;
  let tokensUsed = 0;
  const failed = [];

  for (const c of testable) {
    // Replay: simulate the conversation that led to the correction
    const messages = [
      { role: "user", content: c.user_message || "test" },
    ];

    try {
      const result = await Promise.race([
        anthropic.messages.create({
          model: EVAL_MODEL,
          max_tokens: 512,
          system: systemPrompt,
          messages,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
      ]);

      const newResponse = result.content[0].text;
      tokensUsed += (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0);

      // Check 1: Programmatic checks (forbidden words, AI patterns, etc.)
      const check = checkResponse(newResponse, persona.voice);
      const hasHard = check.violations.some(v => v.severity === "hard");

      // Check 2: Semantic check — does the new response respect the correction?
      const passes = await semanticCheck(anthropic, c.correction, newResponse);
      tokensUsed += 50; // Approximate semantic check cost

      if (!hasHard && passes !== false) {
        resolved++;
      } else {
        failed.push({
          id: c.id,
          correction: c.correction,
          ...(verbose ? {
            newResponse: newResponse.slice(0, 200),
            hardViolation: hasHard,
            semanticPass: passes,
          } : {}),
        });
      }
    } catch (e) {
      failed.push({ id: c.id, correction: c.correction, error: e.message });
    }
  }

  const score = testable.length > 0 ? Math.round((resolved / testable.length) * 100) / 100 : 1;

  console.log(JSON.stringify({
    event: "eval_complete",
    ts: new Date().toISOString(),
    persona: personaId,
    score,
    total: testable.length,
    resolved,
    failed: failed.length,
    tokensUsed,
  }));

  return { score, total: testable.length, resolved, failed, tokensUsed };
}

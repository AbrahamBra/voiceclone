import Anthropic from "@anthropic-ai/sdk";
import { checkResponse } from "./checks.js";

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";
const MAX_REWRITES = 1;

/**
 * Run the pipeline: generate → programmatic checks → rewrite if hard violation.
 * No more Haiku scoring — checks are deterministic and instant.
 */
export async function runPipeline({ systemPrompt, messages, sse, res, voiceRules, corrections, apiKey }) {
  const client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  let totalInput = 0, totalOutput = 0;

  // PASS 1: Generate (streaming)
  sse("thinking");
  const stream1 = client.messages.stream({
    model: DEFAULT_MODEL, max_tokens: 2048, system: systemPrompt, messages,
  });
  let currentText = "";
  stream1.on("text", (text) => { currentText += text; sse("delta", { text }); });
  const msg1 = await stream1.finalMessage();
  if (msg1.usage) { totalInput += msg1.usage.input_tokens; totalOutput += msg1.usage.output_tokens; }
  const t1 = Date.now();

  // PASS 2: Programmatic checks (instant, ~0ms)
  const check = checkResponse(currentText, voiceRules);

  // Rewrite only if hard violation (forbidden word, self-reveal, prompt leak)
  if (check.shouldRewrite && MAX_REWRITES > 0) {
    const hardViolations = check.violations.filter(v => v.severity === "hard");
    const feedback = hardViolations.map(v => `- ${v.type}: ${v.detail}`).join("\n");

    sse("rewriting", { attempt: 1, feedback });
    sse("clear");

    const rewriteStream = client.messages.stream({
      model: DEFAULT_MODEL, max_tokens: 1024, system: systemPrompt,
      messages: [
        ...messages,
        { role: "assistant", content: currentText },
        { role: "user", content: `SYSTEME INTERNE — Violations detectees :\n${feedback}\n\nReecris ton message en corrigeant ces problemes. Garde le meme intent.\nReponds UNIQUEMENT avec le message corrige.` },
      ],
    });

    currentText = "";
    rewriteStream.on("text", (text) => { currentText += text; sse("delta", { text }); });
    const rewriteMsg = await rewriteStream.finalMessage();
    if (rewriteMsg.usage) { totalInput += rewriteMsg.usage.input_tokens; totalOutput += rewriteMsg.usage.output_tokens; }
  }

  // Done
  const nonLight = check.violations.filter(v => v.severity !== "light");
  sse("done", {
    violations: nonLight.length > 0 ? nonLight : undefined,
    rewritten: check.shouldRewrite,
  });

  const t2 = Date.now();
  console.log(JSON.stringify({
    event: "chat_complete", ts: new Date().toISOString(),
    totalMs: t2 - t0, generateMs: t1 - t0,
    violations: check.violations.length, rewritten: check.shouldRewrite,
    tokens: { input: totalInput, output: totalOutput },
  }));

  return { usage: { input_tokens: totalInput, output_tokens: totalOutput }, text: currentText };
}

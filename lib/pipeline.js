import Anthropic from "@anthropic-ai/sdk";
import { checkResponse } from "./checks.js";
import { inlineFidelityCheck, computeStyleMetrics } from "./fidelity.js";

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";
const MAX_REWRITES = 1;
const STREAM_TIMEOUT_MS = 45000; // 45s — Vercel serverless max is 60s

/** Strip lone surrogates that break Claude API JSON serialization */
function sanitize(str) {
  if (typeof str !== "string") return str;
  return str.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

/**
 * Build system param with prompt caching.
 * The full system prompt is cached as a single block — it's stable within a
 * conversation (voice + corrections + scenario + ontology + knowledge).
 * Cache TTL is 5 min on Anthropic's side, matching our in-memory cache.
 */
function buildCachedSystem(systemPrompt) {
  const safe = sanitize(systemPrompt);
  return [{ type: "text", text: safe, cache_control: { type: "ephemeral" } }];
}

/**
 * Run the pipeline: generate → programmatic checks → rewrite if hard violation.
 * No more Haiku scoring — checks are deterministic and instant.
 */
export async function runPipeline({ systemPrompt, messages, sse, res, voiceRules, corrections, apiKey, model, personaId }) {
  const client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  let totalInput = 0, totalOutput = 0;
  let cacheRead = 0, cacheCreation = 0;
  const useModel = model || DEFAULT_MODEL;

  // PASS 1: Generate (streaming)
  sse("thinking");
  const safeMessages = messages.map(m => ({ ...m, content: sanitize(m.content) }));
  const cachedSystem = buildCachedSystem(systemPrompt);

  const stream1 = client.messages.stream({
    model: useModel, max_tokens: 2048, system: cachedSystem, messages: safeMessages,
  });
  let currentText = "";
  stream1.on("text", (text) => { currentText += text; sse("delta", { text }); });
  const msg1 = await Promise.race([
    stream1.finalMessage(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("stream_timeout")), STREAM_TIMEOUT_MS)),
  ]);
  if (msg1.usage) {
    totalInput += msg1.usage.input_tokens;
    totalOutput += msg1.usage.output_tokens;
    cacheRead += msg1.usage.cache_read_input_tokens || 0;
    cacheCreation += msg1.usage.cache_creation_input_tokens || 0;
  }
  const t1 = Date.now();

  // PASS 2: Programmatic checks (instant, ~0ms)
  const check = checkResponse(currentText, voiceRules);

  // PASS 2b: Inline fidelity guard (async, ~100-150ms, non-blocking for rewrite decision)
  let fidelityDrift = null;
  if (personaId) {
    try {
      fidelityDrift = await inlineFidelityCheck(personaId, currentText);
      if (fidelityDrift?.drifted) {
        check.violations.push({
          type: "fidelity_drift",
          severity: "strong",
          detail: `cosine=${fidelityDrift.similarity.toFixed(3)} < ${fidelityDrift.threshold}`,
        });
      }
    } catch { /* fidelity guard is best-effort */ }
  }

  // Rewrite only if hard violation (forbidden word, self-reveal, prompt leak)
  if (check.shouldRewrite && MAX_REWRITES > 0) {
    const hardViolations = check.violations.filter(v => v.severity === "hard");
    const feedback = hardViolations.map(v => `- ${v.type}: ${v.detail}`).join("\n");

    sse("rewriting", { attempt: 1, feedback });
    sse("clear");

    const rewriteStream = client.messages.stream({
      model: useModel, max_tokens: 1024, system: cachedSystem,
      messages: [
        ...safeMessages,
        { role: "assistant", content: currentText },
        { role: "user", content: `SYSTEME INTERNE — Violations detectees :\n${feedback}\n\nReecris ton message en corrigeant ces problemes. Garde le meme intent.\nReponds UNIQUEMENT avec le message corrige.` },
      ],
    });

    currentText = "";
    rewriteStream.on("text", (text) => { currentText += text; sse("delta", { text }); });
    const rewriteMsg = await Promise.race([
      rewriteStream.finalMessage(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("rewrite_timeout")), STREAM_TIMEOUT_MS)),
    ]);
    if (rewriteMsg.usage) {
      totalInput += rewriteMsg.usage.input_tokens;
      totalOutput += rewriteMsg.usage.output_tokens;
      cacheRead += rewriteMsg.usage.cache_read_input_tokens || 0;
      cacheCreation += rewriteMsg.usage.cache_creation_input_tokens || 0;
    }
  }

  // Done
  const nonLight = check.violations.filter(v => v.severity !== "light");
  sse("done", {
    violations: nonLight.length > 0 ? nonLight : undefined,
    rewritten: check.shouldRewrite,
  });

  // Live style metrics on real output (after checks + potential rewrite)
  const liveMetrics = currentText.length > 20 ? computeStyleMetrics(currentText, voiceRules) : null;

  const t2 = Date.now();
  console.log(JSON.stringify({
    event: "chat_complete", ts: new Date().toISOString(),
    model: useModel, totalMs: t2 - t0, generateMs: t1 - t0,
    violations: check.violations.length, rewritten: check.shouldRewrite,
    fidelity: fidelityDrift ? { similarity: fidelityDrift.similarity, drifted: fidelityDrift.drifted } : undefined,
    live_style: liveMetrics ? {
      avgSentenceLen: liveMetrics.avgSentenceLen,
      kurtosis: liveMetrics.kurtosis,
      questionRatio: liveMetrics.questionRatio,
      ttr: liveMetrics.ttr,
      signaturePresence: liveMetrics.signaturePresence,
      forbiddenHits: liveMetrics.forbiddenHits,
    } : undefined,
    tokens: { input: totalInput, output: totalOutput, cache_read: cacheRead, cache_creation: cacheCreation },
  }));

  return { usage: { input_tokens: totalInput, output_tokens: totalOutput, cache_read: cacheRead, cache_creation: cacheCreation }, text: currentText };
}

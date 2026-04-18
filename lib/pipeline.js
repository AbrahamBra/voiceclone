import Anthropic from "@anthropic-ai/sdk";
import { checkResponse } from "./checks.js";
import { inlineFidelityCheck, computeStyleMetrics } from "./fidelity.js";
import { evaluateAgainstPersona, persistShadow } from "./critic/rhythmCritic.js";
import { log } from "./log.js";

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
 * Tag the last user message with an ephemeral cache breakpoint, so the full
 * conversation history (everything up to and including that message) is
 * eligible for prompt caching. The rewrite pass re-sends the same prefix plus
 * a new assistant/user turn, hitting this cache instead of reprocessing the
 * whole history. No-op when content is already in array form.
 */
function withMessageCaching(messages) {
  const lastUserIdx = messages.map(m => m.role).lastIndexOf("user");
  if (lastUserIdx === -1) return messages;
  const msg = messages[lastUserIdx];
  if (typeof msg.content !== "string") return messages;
  const cached = {
    ...msg,
    content: [{ type: "text", text: msg.content, cache_control: { type: "ephemeral" } }],
  };
  return [...messages.slice(0, lastUserIdx), cached, ...messages.slice(lastUserIdx + 1)];
}

/**
 * Race a stream.finalMessage() against a timeout.
 * If timeout wins, returns a synthetic "finished due to timeout" message with
 * whatever text was streamed so far — so the pipeline can keep going instead
 * of crashing on a rejected promise.
 */
async function awaitFinalMessageOrTimeout(stream, getCurrentText, timeoutMs, label) {
  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __timeout: true }), timeoutMs);
  });
  try {
    const result = await Promise.race([stream.finalMessage(), timeoutPromise]);
    if (result && result.__timeout) {
      log(`${label}_timeout`, { ms: timeoutMs, streamed_chars: getCurrentText().length });
      return {
        stop_reason: "max_tokens",
        content: [{ type: "text", text: getCurrentText() }],
        usage: { input_tokens: 0, output_tokens: 0 },
        __timedOut: true,
      };
    }
    return result;
  } catch (err) {
    log(`${label}_error`, { error: err?.message || String(err), streamed_chars: getCurrentText().length });
    return {
      stop_reason: "error",
      content: [{ type: "text", text: getCurrentText() }],
      usage: { input_tokens: 0, output_tokens: 0 },
      __errored: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run the pipeline: generate → programmatic checks → rewrite if hard violation.
 * No more Haiku scoring — checks are deterministic and instant.
 */
export async function runPipeline({ systemPrompt, messages, sse, res, voiceRules, corrections, apiKey, model, personaId, conversationId, rhythmCtx }) {
  const client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  const t0 = Date.now();
  let totalInput = 0, totalOutput = 0;
  let cacheRead = 0, cacheCreation = 0;
  const useModel = model || DEFAULT_MODEL;

  // PASS 1: Generate (streaming)
  sse("thinking");
  const safeMessages = messages.map(m => ({ ...m, content: sanitize(m.content) }));
  const cachedSystem = buildCachedSystem(systemPrompt);
  const cachedMessages = withMessageCaching(safeMessages);

  const stream1 = client.messages.stream({
    model: useModel, max_tokens: 2048, system: cachedSystem, messages: cachedMessages,
  });
  let currentText = "";
  stream1.on("text", (text) => { currentText += text; sse("delta", { text }); });
  const msg1 = await awaitFinalMessageOrTimeout(stream1, () => currentText, STREAM_TIMEOUT_MS, "stream");
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

  // PASS 2c: Critic (setter + rythme + voix).
  // - Évalue sync (baseline + voice sont en cache 1h → ~5ms typique)
  // - Persiste le shadow fire-and-forget
  // - Promeut les violations voix V1/V2 en hard pour déclencher le rewrite existant
  let criticResult = null;
  if (personaId && currentText.length > 10) {
    try {
      criticResult = await evaluateAgainstPersona(currentText, { personaId, ctx: rhythmCtx || {} });
    } catch { /* critic eval best-effort */ }
    if (criticResult) {
      persistShadow({
        personaId,
        conversationId: conversationId || null,
        draft: currentText,
        result: criticResult,
      }).catch(() => {});
      // Promote voice violations V1 (forbidden) + V2 (anglicized verb) to hard
      // so the existing rewrite path (below) addresses them.
      for (const v of criticResult.violations || []) {
        if (v.id === "V1" || v.id === "V2") {
          check.violations.push({
            type: v.id === "V1" ? "forbidden_word_persona" : "anglicized_verb",
            severity: "hard",
            detail: v.reason,
          });
        }
      }
      check.shouldRewrite = check.shouldRewrite || check.violations.some(v => v.severity === "hard");
    }
  }

  // Rewrite only if hard violation (forbidden word, self-reveal, prompt leak)
  if (check.shouldRewrite && MAX_REWRITES > 0) {
    const hardViolations = check.violations.filter(v => v.severity === "hard");
    const feedback = hardViolations.map(v => `- ${v.type}: ${v.detail}`).join("\n");

    sse("rewriting", { attempt: 1, feedback });
    sse("clear");

    // Reuse cachedMessages (same object as pass 1) so the shared prefix hits
    // the cache breakpoint set up above; the appended turns are not cached.
    const rewriteStream = client.messages.stream({
      model: useModel, max_tokens: 1024, system: cachedSystem,
      messages: [
        ...cachedMessages,
        { role: "assistant", content: currentText },
        { role: "user", content: `SYSTEME INTERNE — Violations detectees :\n${feedback}\n\nReecris ton message en corrigeant ces problemes. Garde le meme intent.\nReponds UNIQUEMENT avec le message corrige.` },
      ],
    });

    currentText = "";
    rewriteStream.on("text", (text) => { currentText += text; sse("delta", { text }); });
    const rewriteMsg = await awaitFinalMessageOrTimeout(rewriteStream, () => currentText, STREAM_TIMEOUT_MS, "rewrite");
    if (rewriteMsg.usage) {
      totalInput += rewriteMsg.usage.input_tokens;
      totalOutput += rewriteMsg.usage.output_tokens;
      cacheRead += rewriteMsg.usage.cache_read_input_tokens || 0;
      cacheCreation += rewriteMsg.usage.cache_creation_input_tokens || 0;
    }

    // Re-check fidelity on the REWRITTEN text. Before this, the cockpit
    // displayed the pass-1 cosine even when the rewrite clearly recovered
    // the voice — misleading. Cost: ~100-150ms embedding call.
    if (personaId) {
      try {
        const postFidelity = await inlineFidelityCheck(personaId, currentText);
        if (postFidelity) {
          fidelityDrift = postFidelity;
          // If rewrite resolved the drift, strip the earlier drift violation
          // so the rules counter doesn't keep it as an active issue.
          if (!postFidelity.drifted) {
            check.violations = check.violations.filter(v => v.type !== "fidelity_drift");
          }
        }
      } catch { /* best-effort */ }
    }
  }

  // Live style metrics on the final output (after potential rewrite).
  const liveMetrics = currentText.length > 20 ? computeStyleMetrics(currentText, voiceRules) : null;
  const liveStylePayload = liveMetrics ? {
    avgSentenceLen: liveMetrics.avgSentenceLen,
    kurtosis: liveMetrics.kurtosis,
    questionRatio: liveMetrics.questionRatio,
    ttr: liveMetrics.ttr,
    signaturePresence: liveMetrics.signaturePresence,
    forbiddenHits: liveMetrics.forbiddenHits,
  } : undefined;
  const fidelityPayload = fidelityDrift ? {
    similarity: fidelityDrift.similarity,
    threshold: fidelityDrift.threshold,
    drifted: fidelityDrift.drifted,
  } : undefined;

  const t2 = Date.now();
  // Per-message timing + token accounting for the lab-notebook UI. The cockpit
  // audit strip accumulates running totals from these payloads.
  const timingPayload = {
    totalMs: t2 - t0,
    generateMs: t1 - t0,
  };
  const tokensPayload = {
    input: totalInput,
    output: totalOutput,
    cache_read: cacheRead,
    cache_creation: cacheCreation,
  };

  // Done — send ALL violations (including light ones: ai_cliches, ai_patterns_fr,
  // markdown). The UI cockpit tracks per-rule activation counts; filtering light
  // violations here meant those counters could never increment. rewritten still
  // only fires on hard/strong, driven by check.shouldRewrite.
  sse("done", {
    violations: check.violations.length > 0 ? check.violations : undefined,
    rewritten: check.shouldRewrite,
    fidelity: fidelityPayload,
    live_style: liveStylePayload,
    timing: timingPayload,
    tokens: tokensPayload,
    model: useModel,
  });

  log("chat_complete", {
    model: useModel, totalMs: t2 - t0, generateMs: t1 - t0,
    violations: check.violations.length, rewritten: check.shouldRewrite,
    fidelity: fidelityPayload,
    live_style: liveStylePayload,
    tokens: tokensPayload,
  });

  return { usage: { input_tokens: totalInput, output_tokens: totalOutput, cache_read: cacheRead, cache_creation: cacheCreation }, text: currentText };
}

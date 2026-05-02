import Anthropic from "@anthropic-ai/sdk";
import { checkResponse } from "./checks.js";
import { inlineFidelityCheck, computeStyleMetrics } from "./fidelity.js";
import { evaluateAgainstPersona, evaluateRhythm } from "./critic/rhythmCritic.js";
import { getActiveHardRules } from "./protocol-db.js";
import { checkProtocolRules } from "./protocolChecks.js";
import { log } from "./log.js";

/**
 * Synchronous critic check used by the eval harness — no API calls, no DB.
 * Combines the deterministic content checks (forbidden words, self-reveal,
 * AI clichés/patterns, markdown) with the voice critic (V1 forbidden words /
 * V2 anglicized verbs / V3 hyphen connector). Returns `{ pass, violations }`.
 *
 * `client` is accepted for signature compatibility with the eval runner but
 * unused — all checks are local. Pass `voiceRules` per test case so the
 * critic has the right forbidden/signature lists to evaluate against.
 */
// eslint-disable-next-line no-unused-vars
export function criticCheck(client, input, voiceRules = {}) {
  const checks = checkResponse(input, voiceRules);
  const rhythm = evaluateRhythm(input, { personaVoice: voiceRules });
  const violations = [
    ...checks.violations,
    ...rhythm.violations.map(v => ({
      type: v.id ? `voice_${v.id}` : "voice",
      severity: v.id === "V1" || v.id === "V2" ? "hard" : "strong",
      detail: v.reason,
    })),
  ];
  // Eval semantic: any flagged violation (hard or strong) = not passing.
  // Light violations (e.g., `no_signature` info) are excluded so a clean
  // message without a signature phrase doesn't accidentally fail the eval.
  const hasFailing = violations.some(v => v.severity === "hard" || v.severity === "strong");
  return { pass: !hasFailing, violations };
}

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
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
export async function runPipeline({ systemPrompt, messages, sse, res, voiceRules, corrections, apiKey, model, personaId, conversationId, rhythmCtx, sources }) {
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
      fidelityDrift = await inlineFidelityCheck(personaId, currentText, { voice: voiceRules });
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
  // - Promeut les violations voix V1/V2 en hard pour déclencher le rewrite existant
  // Sprint A purge (2026-05-01) : la persistance shadow vers rhythm_shadow
  // a été retirée — la table était écrite à chaque chat sans jamais être lue
  // par autre chose que des scripts de diag. Le critic reste sync.
  let criticResult = null;
  if (personaId && currentText.length > 10) {
    try {
      criticResult = await evaluateAgainstPersona(currentText, { personaId, ctx: rhythmCtx || {} });
    } catch { /* critic eval best-effort */ }
    if (criticResult) {
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

  // PASS 2d: Operating protocol hard rules.
  // Best-effort — an error here must never block generation. The rules come
  // from an opt-in protocol the operator activated manually; if the cache or
  // DB hiccups, falling back to "no protocol" is the safe default.
  if (personaId) {
    try {
      const rules = await getActiveHardRules(personaId, rhythmCtx?.scenario);
      if (rules.length > 0) {
        const protoCheck = checkProtocolRules(currentText, rules, { scenario: rhythmCtx?.scenario });
        for (const v of protoCheck.violations) check.violations.push(v);
        check.shouldRewrite = check.shouldRewrite || protoCheck.shouldRewrite;
        if (protoCheck.violations.length > 0) {
          log("protocol_check_fired", {
            persona: personaId,
            count: protoCheck.violations.length,
            hard: protoCheck.violations.filter(v => v.severity === "hard").map(v => v.rule_id),
          });
        }
      }
    } catch (err) {
      log("protocol_check_error", { error: err?.message || String(err) });
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
        const postFidelity = await inlineFidelityCheck(personaId, currentText, { voice: voiceRules });
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
    sources: sources || undefined,
  });

  log("chat_complete", {
    model: useModel, totalMs: t2 - t0, generateMs: t1 - t0,
    violations: check.violations.length, rewritten: check.shouldRewrite,
    fidelity: fidelityPayload,
    live_style: liveStylePayload,
    tokens: tokensPayload,
  });

  return {
    usage: { input_tokens: totalInput, output_tokens: totalOutput, cache_read: cacheRead, cache_creation: cacheCreation },
    text: currentText,
  };
}

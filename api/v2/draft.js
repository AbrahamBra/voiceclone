// ============================================================
// POST /api/v2/draft — synchronous draft endpoint for automation.
//
// Same persona stack as /api/chat (full voice + corrections + protocol +
// artifacts) but returns a single JSON payload instead of SSE. Designed for
// CRM / n8n / Zapier flows that want "draft-before-send" with a confidence
// score they can branch on.
//
// Auth : x-session-token or x-access-code (same as /api/chat).
// No conversation persistence — stateless by design (the calling system owns
// the thread state). To run inside an existing conv, use /api/chat instead.
//
// Body :
//   { personaId, prospectContext, scenarioType?, sourceCore?, history?, rewrite? }
//
// Returns :
//   {
//     draft, confidence, model, violations, fidelity, tokens, ms,
//     rewritten, sources
//   }
//
// Confidence score is deterministic, computed from checkResponse violations
// only — no extra LLM call.
//
// Handler accepts an optional `deps` 3rd argument for test injection
// (matching the pattern used by api/v2/protocol.js).
// ============================================================

export const maxDuration = 30;

import Anthropic from "@anthropic-ai/sdk";
import { rateLimit as _rateLimit } from "../_rateLimit.js";
import {
  authenticateRequest as _authenticateRequest,
  checkBudget as _checkBudget,
  getApiKey as _getApiKey,
  hasPersonaAccess as _hasPersonaAccess,
  setCors as _setCors,
  supabase as _supabase,
  logUsage as _logUsage,
} from "../../lib/supabase.js";
import {
  getPersonaFromDb as _getPersonaFromDb,
  loadScenarioFromDb as _loadScenarioFromDb,
  getCorrectionsFromDb as _getCorrectionsFromDb,
  findRelevantEntities as _findRelevantEntities,
} from "../../lib/knowledge-db.js";
import { getActiveHardRules as _getActiveHardRules } from "../../lib/protocol-db.js";
import { getActiveArtifactsForPersona as _getActiveArtifactsForPersona } from "../../lib/protocol-v2-db.js";
import { buildSystemPrompt as _buildSystemPrompt } from "../../lib/prompt.js";
import { checkResponse as _checkResponse } from "../../lib/checks.js";
import { inlineFidelityCheck as _inlineFidelityCheck } from "../../lib/fidelity.js";
import { selectModel as _selectModel } from "../../lib/model-router.js";
import { isScenarioId as _isScenarioId } from "../../src/lib/scenarios.js";
import { log as _log } from "../../lib/log.js";

const SOURCE_CORE_VALUES = new Set([
  "visite_profil", "dr_recue", "interaction_contenu",
  "premier_degre", "spyer", "sales_nav",
]);

const SYNC_TIMEOUT_MS = 25000;
const MAX_PROSPECT_CONTEXT = 10000;
const MAX_HISTORY_MSGS = 10;

function validate(body) {
  if (!body || typeof body !== "object") return "Body must be an object";
  if (typeof body.personaId !== "string" || !body.personaId) {
    return "personaId is required";
  }
  if (typeof body.prospectContext !== "string" || !body.prospectContext.trim()) {
    return "prospectContext is required";
  }
  if (body.prospectContext.length > MAX_PROSPECT_CONTEXT) {
    return `prospectContext too long (max ${MAX_PROSPECT_CONTEXT} chars)`;
  }
  if (body.history !== undefined) {
    if (!Array.isArray(body.history) || body.history.length > MAX_HISTORY_MSGS) {
      return `history must be an array of at most ${MAX_HISTORY_MSGS} messages`;
    }
    for (const m of body.history) {
      if (!m || !["user", "assistant"].includes(m.role)) {
        return "history messages must have role 'user' or 'assistant'";
      }
      if (typeof m.content !== "string" || !m.content) {
        return "history messages must have non-empty string content";
      }
    }
  }
  return null;
}

/**
 * Confidence score from check violations + fidelity drift. Deterministic,
 * no LLM call. Tuned so:
 *   - 1 hard violation drops confidence ~40 pts
 *   - 1 strong drops ~15 pts
 *   - drift below threshold drops ~25 pts
 *   - no violations + no drift = 1.0
 */
function computeConfidence(violations, fidelity) {
  let score = 1.0;
  for (const v of violations || []) {
    if (v.severity === "hard") score -= 0.4;
    else if (v.severity === "strong") score -= 0.15;
    else if (v.severity === "light") score -= 0.05;
  }
  if (fidelity?.drifted) score -= 0.25;
  return Math.max(0, Math.round(score * 100) / 100);
}

async function defaultGenerate({ apiKey, model, systemPrompt, messages }) {
  const client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SYNC_TIMEOUT_MS);
  try {
    return await client.messages.create({
      model,
      max_tokens: 1024,
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      messages,
    }, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res, deps) {
  const {
    rateLimit = _rateLimit,
    authenticateRequest = _authenticateRequest,
    checkBudget = _checkBudget,
    getApiKey = _getApiKey,
    hasPersonaAccess = _hasPersonaAccess,
    setCors = _setCors,
    supabase = _supabase,
    logUsage = _logUsage,
    getPersonaFromDb = _getPersonaFromDb,
    loadScenarioFromDb = _loadScenarioFromDb,
    getCorrectionsFromDb = _getCorrectionsFromDb,
    findRelevantEntities = _findRelevantEntities,
    getActiveHardRules = _getActiveHardRules,
    getActiveArtifactsForPersona = _getActiveArtifactsForPersona,
    buildSystemPrompt = _buildSystemPrompt,
    checkResponse = _checkResponse,
    inlineFidelityCheck = _inlineFidelityCheck,
    selectModel = _selectModel,
    isScenarioId = _isScenarioId,
    log = _log,
    generate = defaultGenerate,
  } = deps || {};

  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const t0 = Date.now();

  const ip = req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.socket?.remoteAddress
    || "unknown";
  const rl = await rateLimit(ip);
  if (!rl.allowed) {
    res.status(429).json({ error: "Too many requests", retryAfter: rl.retryAfter });
    return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  if (!isAdmin) {
    const budget = checkBudget(client);
    if (!budget.allowed) {
      res.status(402).json({ error: "Budget depasse", action: "add_api_key" });
      return;
    }
  }

  const validationError = validate(req.body);
  if (validationError) { res.status(400).json({ error: validationError }); return; }

  const {
    personaId, prospectContext, history = [],
    scenarioType: rawScenarioType, sourceCore: rawSourceCore,
    rewrite = false,
  } = req.body;

  const scenarioType = isScenarioId(rawScenarioType) ? rawScenarioType : null;
  const sourceCore = SOURCE_CORE_VALUES.has(rawSourceCore) ? rawSourceCore : null;

  const persona = await getPersonaFromDb(personaId);
  if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }

  if (client && !isAdmin && persona.client_id !== client.id) {
    if (!(await hasPersonaAccess(client.id, personaId))) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  // Resolve scenario — pick scenarioType-mapped scenario when possible,
  // otherwise default → first available.
  const scenarioConfig =
    persona.scenarios?.default ||
    Object.values(persona.scenarios || {})[0] ||
    null;
  const scenarioSlug = scenarioConfig?.slug || "default";
  const baseScenarioContent = await loadScenarioFromDb(personaId, scenarioSlug).catch(() => null);

  const messages = [
    ...history.map(({ role, content }) => ({ role, content })),
    { role: "user", content: prospectContext.trim() },
  ];

  // Load full persona stack in parallel. Best-effort — sub-failures degrade
  // quality but never 5xx the request.
  const [ontology, corrections, protocolRules, protocolArtifacts] = await Promise.all([
    findRelevantEntities(personaId, messages).catch(() => ({ entities: [], relations: [], boostTerms: [] })),
    getCorrectionsFromDb(personaId).catch(() => null),
    getActiveHardRules(personaId, scenarioSlug).catch(() => []),
    getActiveArtifactsForPersona(supabase, personaId, { sourceCore }).catch(() => []),
  ]);

  if (ontology.relations) {
    const entityMap = {};
    for (const e of ontology.entities || []) entityMap[e.id] = e.name;
    for (const r of ontology.relations) {
      r.from_name = entityMap[r.from_entity_id] || "?";
      r.to_name = entityMap[r.to_entity_id] || "?";
    }
  }

  const {
    prompt: systemPrompt,
    detectedPages,
    injectedEntities,
    injectedCorrectionsCount,
  } = buildSystemPrompt({
    persona,
    knowledgeMatches: [],
    scenarioContent: baseScenarioContent,
    corrections,
    ontology,
    protocolRules,
    protocolArtifacts,
    scenarioSlug,
  });

  const routing = selectModel({
    message: prospectContext, knowledgeMatches: [], ontology, corrections, scenario: scenarioSlug,
  });

  const apiKey = getApiKey(client);
  let totalInput = 0, totalOutput = 0, cacheRead = 0, cacheCreation = 0;
  let draftText = "";
  const usedModel = routing.model;
  let rewritten = false;

  try {
    const msg = await generate({ apiKey, model: usedModel, systemPrompt, messages });
    draftText = msg.content?.[0]?.text || "";
    if (msg.usage) {
      totalInput += msg.usage.input_tokens || 0;
      totalOutput += msg.usage.output_tokens || 0;
      cacheRead += msg.usage.cache_read_input_tokens || 0;
      cacheCreation += msg.usage.cache_creation_input_tokens || 0;
    }
  } catch (err) {
    log("v2_draft_generate_error", { ip, persona: personaId, error: err?.message });
    res.status(502).json({ error: "Generation failed", detail: err?.message });
    return;
  }

  const check = checkResponse(draftText, persona.voice || {});

  let fidelity = null;
  try { fidelity = await inlineFidelityCheck(personaId, draftText, { voice: persona.voice }); } catch { /* best-effort */ }

  if (rewrite && check.shouldRewrite) {
    const hardViolations = check.violations.filter((v) => v.severity === "hard");
    const feedback = hardViolations.map((v) => `- ${v.type}: ${v.detail}`).join("\n");
    try {
      const rewriteMsg = await generate({
        apiKey, model: usedModel, systemPrompt,
        messages: [
          ...messages,
          { role: "assistant", content: draftText },
          { role: "user", content: `SYSTEME INTERNE — Violations detectees :\n${feedback}\n\nReecris ton message en corrigeant ces problemes. Garde le meme intent.\nReponds UNIQUEMENT avec le message corrige.` },
        ],
      });
      const rewriteText = rewriteMsg.content?.[0]?.text || "";
      if (rewriteText) {
        draftText = rewriteText;
        rewritten = true;
        if (rewriteMsg.usage) {
          totalInput += rewriteMsg.usage.input_tokens || 0;
          totalOutput += rewriteMsg.usage.output_tokens || 0;
          cacheRead += rewriteMsg.usage.cache_read_input_tokens || 0;
          cacheCreation += rewriteMsg.usage.cache_creation_input_tokens || 0;
        }
        const recheck = checkResponse(draftText, persona.voice || {});
        check.violations = recheck.violations;
        check.shouldRewrite = recheck.shouldRewrite;
        try { fidelity = await inlineFidelityCheck(personaId, draftText, { voice: persona.voice }); } catch { /* best-effort */ }
      }
    } catch (err) {
      log("v2_draft_rewrite_error", { persona: personaId, error: err?.message });
    }
  }

  const confidence = computeConfidence(check.violations, fidelity);
  const ms = Date.now() - t0;

  if (client?.id && logUsage) {
    Promise.resolve(logUsage({
      clientId: client.id,
      model: usedModel,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheCreation,
      endpoint: "v2_draft",
    })).catch(() => {});
  }

  log("v2_draft_completed", {
    persona: personaId,
    model: usedModel,
    confidence,
    violations: check.violations.length,
    rewritten,
    drifted: !!fidelity?.drifted,
    ms,
    tokens_in: totalInput,
    tokens_out: totalOutput,
  });

  res.status(200).json({
    draft: draftText,
    confidence,
    model: usedModel,
    violations: check.violations,
    fidelity: fidelity ? {
      similarity: fidelity.similarity,
      threshold: fidelity.threshold,
      drifted: fidelity.drifted,
    } : null,
    rewritten,
    sources: {
      knowledgePages: detectedPages || [],
      entities: injectedEntities || [],
      correctionsCount: injectedCorrectionsCount || 0,
    },
    tokens: {
      input: totalInput,
      output: totalOutput,
      cache_read: cacheRead,
      cache_creation: cacheCreation,
    },
    ms,
  });
}

// Exported for test injection — never used in prod (callers go through deps).
export { defaultGenerate, validate, computeConfidence };

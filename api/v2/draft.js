// ============================================================
// POST /api/v2/draft — synchronous draft endpoint for automation.
//
// V3.6.5 / PR-1 — Breakcold workflow surface :
//   - Accepts API-key auth (x-api-key) for machine flow OR session/access-code
//     for operator flow. The API key pins the persona.
//   - Body accepts both legacy { personaId, prospectContext } and the
//     V3.6.5 spec { persona_id, prospect_data, external_lead_ref, stage }.
//   - Auto-scrapes the prospect's LinkedIn profile when prospect_data
//     supplies a linkedin_url and no inline scrape data is passed.
//   - LLM emits a JSON envelope with structured qualification :
//       { qualification: {verdict, reason, confidence}, draft }
//     Verdict thresholds (≥0.7 in, 0.4-0.7 uncertain, <0.4 out) are
//     applied client-side by n8n templates.
//   - Idempotency : when external_lead_ref is provided, a re-fired webhook
//     returns the existing conversation (no duplicate, no LLM call).
//   - Persists a conversation row (lifecycle_state='awaiting_send') so the
//     setter sidebar can surface the draft for send.
//   - Failure mode : 503 + fallback_message for n8n templates to write
//     into Breakcold notes when generation fails.
//
// Auth : x-api-key (machine) OR x-session-token / x-access-code (operator).
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
import { resolveApiKey as _resolveApiKey } from "../../lib/api-key-auth.js";
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
import {
  scrapeLinkedInProfile as _scrapeLinkedInProfile,
  formatScrapeAsContextBlock as _formatScrapeAsContextBlock,
} from "../../lib/linkedin-scrape.js";

const SOURCE_CORE_VALUES = new Set([
  "visite_profil", "dr_recue", "interaction_contenu",
  "premier_degre", "spyer", "sales_nav",
]);

const VERDICT_VALUES = new Set(["in", "uncertain", "out"]);

const SYNC_TIMEOUT_MS = 25000;
const MAX_PROSPECT_CONTEXT = 10000;
const MAX_HISTORY_MSGS = 10;
const MAX_LEAD_REF = 200;

// LLM instruction asking for a structured JSON envelope. Appended to the
// system prompt assembled by buildSystemPrompt. Kept terse and explicit so
// even Haiku stays inside the JSON contract — the parser falls back to plain
// text on any parse failure, but a clean envelope is the success path.
const QUALIFICATION_INSTRUCTION = `

## Format de sortie obligatoire
Réponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans texte autour, suivant exactement ce schéma :
{"qualification":{"verdict":"in|uncertain|out","reason":"<une phrase courte>","confidence":0.0},"draft":"<le message à envoyer au prospect>"}

Règles :
- verdict="in" si le prospect est clairement dans la cible buyer (revenus, taille, fonction, signaux d'intention).
- verdict="out" si le prospect est manifestement hors-cible (early stage sans revenus, hors persona buyer, secteur non couvert).
- verdict="uncertain" en cas de doute (info insuffisante, signaux mixtes).
- confidence ∈ [0, 1] reflétant la solidité du verdict.
- reason : une phrase courte expliquant le verdict (utile pour debug et review humain).
- draft : le message LinkedIn que l'opérateur va envoyer au prospect, voix du clone respectée.
`;

function extractProspectName(text) {
  if (typeof text !== "string") return null;
  const leadMatch = text.match(/\[Contexte lead\s*[—–-]\s*([^\]]+)\]/i);
  if (leadMatch) return leadMatch[1].trim().slice(0, 50) || null;
  return null;
}

function deriveTitle({ prospectName, prospectMessage }) {
  if (prospectName) return prospectName.slice(0, 50);
  const fromCtx = extractProspectName(prospectMessage);
  if (fromCtx) return fromCtx;
  return (prospectMessage || "").slice(0, 50).replace(/\s+\S*$/, "");
}

function validate(body, { apiKeyPinsPersona = false } = {}) {
  if (!body || typeof body !== "object") return "Body must be an object";

  // When the request is authenticated via x-api-key, the key already pins a
  // persona — body.persona_id is optional (and merely cross-checked later).
  // For session/access-code auth, persona_id is the only signal we have, so
  // it stays required.
  const personaId = body.persona_id || body.personaId;
  if (!apiKeyPinsPersona && (typeof personaId !== "string" || !personaId)) {
    return "personaId is required";
  }

  // Resolve prospect context from either shape : new prospect_data object or
  // legacy prospectContext string. Prospect_data wins when both are passed.
  let prospectContext = "";
  if (body.prospect_data && typeof body.prospect_data === "object") {
    if (typeof body.prospect_data.context === "string") {
      prospectContext = body.prospect_data.context;
    } else if (typeof body.prospect_data.text === "string") {
      prospectContext = body.prospect_data.text;
    }
    if (body.prospect_data.linkedin_url !== undefined
        && typeof body.prospect_data.linkedin_url !== "string") {
      return "prospect_data.linkedin_url must be a string";
    }
  } else if (typeof body.prospectContext === "string") {
    prospectContext = body.prospectContext;
  }
  // Allow empty prospect_context when a linkedin_url is present (auto-scrape
  // will fill in the [Contexte lead] block on its own).
  const hasLinkedinUrl = !!(body.prospect_data?.linkedin_url);
  if (!prospectContext.trim() && !hasLinkedinUrl) {
    return "prospectContext is required";
  }
  if (prospectContext.length > MAX_PROSPECT_CONTEXT) {
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

  if (body.external_lead_ref !== undefined) {
    if (typeof body.external_lead_ref !== "string"
        || !body.external_lead_ref.trim()
        || body.external_lead_ref.length > MAX_LEAD_REF) {
      return `external_lead_ref must be a non-empty string ≤ ${MAX_LEAD_REF} chars`;
    }
  }

  return null;
}

/**
 * Confidence score from check violations + fidelity drift. Deterministic,
 * no LLM call. Tuned so :
 *   - 1 hard violation drops confidence ~40 pts
 *   - 1 strong drops ~15 pts
 *   - drift below threshold drops ~25 pts
 *   - no violations + no drift = 1.0
 */
export function computeConfidence(violations, fidelity) {
  let score = 1.0;
  for (const v of violations || []) {
    if (v.severity === "hard") score -= 0.4;
    else if (v.severity === "strong") score -= 0.15;
    else if (v.severity === "light") score -= 0.05;
  }
  if (fidelity?.drifted) score -= 0.25;
  return Math.max(0, Math.round(score * 100) / 100);
}

/**
 * Parse the LLM's JSON envelope. Tolerant by design : strips a code-fence
 * wrapper if the model added one, and falls back to "draft = full text"
 * with qualification=null on any parse failure. Never throws.
 */
export function parseQualificationEnvelope(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) {
    return { qualification: null, draft: "" };
  }
  const stripped = rawText.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(stripped);
    if (!parsed || typeof parsed !== "object") {
      return { qualification: null, draft: rawText.trim() };
    }
    let qualification = null;
    if (parsed.qualification && typeof parsed.qualification === "object") {
      const verdict = VERDICT_VALUES.has(parsed.qualification.verdict)
        ? parsed.qualification.verdict
        : "uncertain";
      const reason = typeof parsed.qualification.reason === "string"
        ? parsed.qualification.reason.slice(0, 500)
        : "";
      const confRaw = parsed.qualification.confidence;
      const confidence = typeof confRaw === "number" && Number.isFinite(confRaw)
        ? Math.max(0, Math.min(1, confRaw))
        : 0.5;
      qualification = { verdict, reason, confidence };
    }
    const draft = typeof parsed.draft === "string" ? parsed.draft : rawText.trim();
    return { qualification, draft };
  } catch {
    return { qualification: null, draft: rawText.trim() };
  }
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
    resolveApiKey = _resolveApiKey,
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
    scrapeLinkedInProfile = _scrapeLinkedInProfile,
    formatScrapeAsContextBlock = _formatScrapeAsContextBlock,
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

  // Auth : machine flow (x-api-key) wins over operator flow (session).
  // API key pins a persona — body's persona_id MUST match if provided.
  let client = null;
  let isAdmin = false;
  let apiKeyPersona = null;
  try {
    const apiKeyAuth = await resolveApiKey(req);
    if (apiKeyAuth) {
      client = apiKeyAuth.client;
      apiKeyPersona = apiKeyAuth.persona;
    } else {
      ({ client, isAdmin } = await authenticateRequest(req));
    }
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

  const validationError = validate(req.body, { apiKeyPinsPersona: !!apiKeyPersona });
  if (validationError) { res.status(400).json({ error: validationError }); return; }

  const body = req.body;
  const personaId = body.persona_id || body.personaId;

  // Prospect data normalization — accept both shapes.
  let prospectContext = "";
  let linkedinUrl = null;
  let prospectName = null;
  if (body.prospect_data && typeof body.prospect_data === "object") {
    prospectContext = (body.prospect_data.context || body.prospect_data.text || "").trim();
    linkedinUrl = body.prospect_data.linkedin_url || null;
    prospectName = body.prospect_data.name || null;
  } else if (typeof body.prospectContext === "string") {
    prospectContext = body.prospectContext.trim();
  }

  const externalLeadRef = typeof body.external_lead_ref === "string"
    ? body.external_lead_ref.trim()
    : null;

  const history = Array.isArray(body.history) ? body.history : [];
  const rawScenarioType = body.scenarioType || body.scenario_type;
  const rawSourceCore = body.sourceCore || body.source_core;
  const rewrite = body.rewrite === true;

  const scenarioType = isScenarioId(rawScenarioType) ? rawScenarioType : null;
  const sourceCoreProvided = rawSourceCore !== undefined && rawSourceCore !== null && rawSourceCore !== "";
  const sourceCore = SOURCE_CORE_VALUES.has(rawSourceCore) ? rawSourceCore : null;
  const warnings = [];
  if (sourceCoreProvided && sourceCore === null) {
    warnings.push(`source_core "${rawSourceCore}" invalide — protocole global utilisé seul (valeurs : ${[...SOURCE_CORE_VALUES].join(", ")})`);
  } else if (!sourceCoreProvided) {
    warnings.push("source_core non fourni — protocole global utilisé seul");
  }

  // Persona resolution.
  let persona;
  if (apiKeyPersona) {
    if (personaId && personaId !== apiKeyPersona.id) {
      res.status(400).json({ error: "personaId in body does not match the persona pinned by the API key" });
      return;
    }
    persona = apiKeyPersona;
  } else {
    persona = await getPersonaFromDb(personaId);
    if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }
    if (client && !isAdmin && persona.client_id !== client.id) {
      if (!(await hasPersonaAccess(client.id, personaId))) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }
  }

  // Idempotency : if external_lead_ref already maps to a conversation, return
  // that conv's last assistant draft without re-generating. Skips LLM cost,
  // skips duplicate inserts when n8n re-fires the webhook.
  if (externalLeadRef && supabase) {
    try {
      const { data: existingConv } = await supabase
        .from("conversations")
        .select("id, persona_id")
        .eq("external_lead_ref", externalLeadRef)
        .maybeSingle();
      if (existingConv?.id) {
        // Refuse cross-persona reuse — same external_lead_ref pointing to a
        // different persona is a config error (n8n template misconfigured).
        if (existingConv.persona_id !== persona.id) {
          res.status(409).json({
            error: "external_lead_ref already mapped to a different persona",
            existing_persona_id: existingConv.persona_id,
          });
          return;
        }
        const { data: lastBot } = await supabase
          .from("messages")
          .select("id, content")
          .eq("conversation_id", existingConv.id)
          .eq("role", "assistant")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        log("v2_draft_idempotent_hit", {
          persona: persona.id,
          conversation_id: existingConv.id,
          external_lead_ref: externalLeadRef,
        });
        res.status(200).json({
          draft: lastBot?.content || "",
          draft_id: lastBot?.id || null,
          conversation_id: existingConv.id,
          persona_id: persona.id,
          qualification: null,
          confidence: null,
          idempotent: true,
          warnings: warnings.length ? warnings : undefined,
          ms: Date.now() - t0,
        });
        return;
      }
    } catch (err) {
      log("v2_draft_idempotency_check_error", { error: err?.message });
      // Fall through to full generation — better to risk a duplicate than
      // 5xx on a transient DB blip. The unique partial index on
      // external_lead_ref still enforces at insert time.
    }
  }

  // Auto-scrape : if a linkedin_url is provided and we don't already have a
  // [Contexte lead] block in the manual prospectContext, fetch the profile
  // and prepend its rendering. Best-effort — a scrape failure proceeds with
  // whatever context the operator passed.
  let scrapeAttempted = false;
  let scrapeOk = false;
  if (linkedinUrl && !/\[Contexte lead/i.test(prospectContext)) {
    scrapeAttempted = true;
    try {
      const scrape = await scrapeLinkedInProfile(linkedinUrl);
      if (scrape) {
        scrapeOk = true;
        const block = formatScrapeAsContextBlock(scrape);
        prospectContext = block + (prospectContext ? "\n\n" + prospectContext : "");
        if (!prospectName && scrape.profile?.name) prospectName = scrape.profile.name;
      }
    } catch (err) {
      log("v2_draft_scrape_error", { url: linkedinUrl, error: err?.message });
    }
  }

  if (!prospectContext.trim()) {
    // Linkedin scrape failed AND no manual context → can't draft anything useful.
    res.status(503).json({
      error: "Impossible d'obtenir un contexte prospect (auto-scrape failed)",
      fallback_message: "VoiceClone unavailable, manual draft needed",
      scrape_attempted: scrapeAttempted,
    });
    return;
  }

  // Resolve scenario.
  const scenarioConfig =
    persona.scenarios?.default ||
    Object.values(persona.scenarios || {})[0] ||
    null;
  const scenarioSlug = scenarioConfig?.slug || "default";
  const baseScenarioContent = await loadScenarioFromDb(persona.id, scenarioSlug).catch(() => null);

  const messages = [
    ...history.map(({ role, content }) => ({ role, content })),
    { role: "user", content: prospectContext },
  ];

  // Load full persona stack in parallel. Best-effort — sub-failures degrade
  // quality but never 5xx the request.
  const [ontology, corrections, protocolRules, protocolArtifacts] = await Promise.all([
    findRelevantEntities(persona.id, messages).catch(() => ({ entities: [], relations: [], boostTerms: [] })),
    getCorrectionsFromDb(persona.id).catch(() => null),
    getActiveHardRules(persona.id, scenarioSlug).catch(() => []),
    getActiveArtifactsForPersona(supabase, persona.id, { sourceCore }).catch(() => []),
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
    prompt: systemPromptBase,
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

  // Append the qualification envelope instruction. Keeps the cached prefix
  // intact (cache_control on the static persona stack) while still nudging
  // the model into structured output.
  const systemPrompt = systemPromptBase + QUALIFICATION_INSTRUCTION;

  const routing = selectModel({
    message: prospectContext, knowledgeMatches: [], ontology, corrections, scenario: scenarioSlug,
  });

  const apiKey = getApiKey(client);
  let totalInput = 0, totalOutput = 0, cacheRead = 0, cacheCreation = 0;
  let rawText = "";
  const usedModel = routing.model;
  let rewritten = false;

  try {
    const msg = await generate({ apiKey, model: usedModel, systemPrompt, messages });
    rawText = msg.content?.[0]?.text || "";
    if (msg.usage) {
      totalInput += msg.usage.input_tokens || 0;
      totalOutput += msg.usage.output_tokens || 0;
      cacheRead += msg.usage.cache_read_input_tokens || 0;
      cacheCreation += msg.usage.cache_creation_input_tokens || 0;
    }
  } catch (err) {
    log("v2_draft_generate_error", { ip, persona: persona.id, error: err?.message });
    res.status(503).json({
      error: "Generation failed",
      detail: err?.message,
      fallback_message: "VoiceClone unavailable, manual draft needed",
    });
    return;
  }

  // Parse the JSON envelope. Falls back to raw text + null qualification on
  // any parse failure (older models, weird wrappers).
  let { qualification, draft: draftText } = parseQualificationEnvelope(rawText);

  const check = checkResponse(draftText, persona.voice || {});

  let fidelity = null;
  try { fidelity = await inlineFidelityCheck(persona.id, draftText, { voice: persona.voice }); } catch { /* best-effort */ }

  if (rewrite && check.shouldRewrite) {
    const hardViolations = check.violations.filter((v) => v.severity === "hard");
    const feedback = hardViolations.map((v) => `- ${v.type}: ${v.detail}`).join("\n");
    try {
      const rewriteMsg = await generate({
        apiKey, model: usedModel, systemPrompt,
        messages: [
          ...messages,
          { role: "assistant", content: rawText },
          { role: "user", content: `SYSTEME INTERNE — Violations detectees :\n${feedback}\n\nReecris ton message en corrigeant ces problemes. Garde le meme intent. Garde le format JSON {qualification, draft}.` },
        ],
      });
      const rewriteRaw = rewriteMsg.content?.[0]?.text || "";
      if (rewriteRaw) {
        const parsed = parseQualificationEnvelope(rewriteRaw);
        // Keep the original qualification verdict — rewrite is style-only.
        if (parsed.draft) {
          draftText = parsed.draft;
          rewritten = true;
          if (parsed.qualification) qualification = parsed.qualification;
        }
        if (rewriteMsg.usage) {
          totalInput += rewriteMsg.usage.input_tokens || 0;
          totalOutput += rewriteMsg.usage.output_tokens || 0;
          cacheRead += rewriteMsg.usage.cache_read_input_tokens || 0;
          cacheCreation += rewriteMsg.usage.cache_creation_input_tokens || 0;
        }
        const recheck = checkResponse(draftText, persona.voice || {});
        check.violations = recheck.violations;
        check.shouldRewrite = recheck.shouldRewrite;
        try { fidelity = await inlineFidelityCheck(persona.id, draftText, { voice: persona.voice }); } catch { /* best-effort */ }
      }
    } catch (err) {
      log("v2_draft_rewrite_error", { persona: persona.id, error: err?.message });
    }
  }

  const confidence = computeConfidence(check.violations, fidelity);
  const ms = Date.now() - t0;

  // Conv + messages persistence — only when an external_lead_ref is provided.
  // The legacy stateless flow (no ref) preserves V3.6.4 behavior so existing
  // callers / tests / ad-hoc CLI usage keep working unchanged.
  let conversationId = null;
  let draftId = null;
  if (externalLeadRef && supabase) {
    const title = deriveTitle({ prospectName, prospectMessage: prospectContext });
    const insertConv = {
      persona_id: persona.id,
      client_id: client?.id || null,
      scenario: "default",
      external_lead_ref: externalLeadRef,
      lifecycle_state: "awaiting_send",
      title: title || null,
    };
    if (sourceCore) insertConv.source_core = sourceCore;
    if (scenarioType) insertConv.scenario_type = scenarioType;

    const { data: newConv, error: convErr } = await supabase
      .from("conversations")
      .insert(insertConv)
      .select("id")
      .single();

    if (convErr) {
      // 23505 = unique violation → another concurrent call already inserted
      // the same external_lead_ref. Look up the row instead of failing.
      if (convErr.code === "23505") {
        const { data: raced } = await supabase
          .from("conversations")
          .select("id")
          .eq("external_lead_ref", externalLeadRef)
          .maybeSingle();
        conversationId = raced?.id || null;
      } else {
        log("v2_draft_conv_insert_error", {
          error: convErr.message,
          code: convErr.code,
          external_lead_ref: externalLeadRef,
        });
      }
    } else {
      conversationId = newConv?.id || null;
    }

    if (conversationId) {
      const { data: insertedMsgs, error: msgErr } = await supabase
        .from("messages")
        .insert([
          { conversation_id: conversationId, role: "user", content: prospectContext, turn_kind: "prospect" },
          { conversation_id: conversationId, role: "assistant", content: draftText, turn_kind: "clone_draft" },
        ])
        .select("id, role");
      if (msgErr) {
        log("v2_draft_msg_insert_error", { conversation_id: conversationId, error: msgErr.message });
      } else if (insertedMsgs) {
        draftId = insertedMsgs.find((m) => m.role === "assistant")?.id || null;
      }
      // Touch last_message_at (best-effort, non-blocking).
      supabase.from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conversationId)
        .then(() => {}, () => {});
    }
  }

  if (client?.id && logUsage) {
    Promise.resolve(logUsage(client.id, persona.id, totalInput, totalOutput, {
      model: usedModel,
      cacheRead,
    })).catch(() => {});
  }

  log("v2_draft_completed", {
    persona: persona.id,
    model: usedModel,
    confidence,
    qualification_verdict: qualification?.verdict || null,
    qualification_confidence: qualification?.confidence ?? null,
    violations: check.violations.length,
    rewritten,
    drifted: !!fidelity?.drifted,
    scrape_attempted: scrapeAttempted,
    scrape_ok: scrapeOk,
    conversation_id: conversationId,
    external_lead_ref: externalLeadRef,
    ms,
    tokens_in: totalInput,
    tokens_out: totalOutput,
  });

  res.status(200).json({
    draft: draftText,
    draft_id: draftId,
    conversation_id: conversationId,
    persona_id: persona.id,
    qualification,
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
    warnings: warnings.length ? warnings : undefined,
    ms,
  });
}

// Exported for test injection / unit cover.
export { defaultGenerate, validate };

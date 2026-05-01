// ============================================================
// POST /api/v2/feedback — machine-flow business outcome ingest.
//
// V3.6.5 / PR-2 — Breakcold workflow surface (Workflow 3 — feedback loop):
//   - x-api-key auth only (machine flow). The operator UI keeps using
//     /api/feedback for the broader correction taxonomy ; this endpoint is
//     scoped to RDV outcomes that originate in Breakcold/n8n.
//   - Body { external_lead_ref, outcome, message_id?, value?, note? } where
//     outcome ∈ {rdv_triggered, rdv_signed, rdv_no_show, rdv_lost}.
//   - Resolves external_lead_ref → conversation_id (must match the persona
//     pinned by the API key), then inserts business_outcomes.
//   - Idempotency : DB unique partial indexes on (conversation_id, outcome)
//     (migration 022 for rdv_signed, 061 for the other rdv_* outcomes) turn
//     retries into 200 + duplicate=true rather than polluting the table.
//
// Auth : x-api-key (machine).
// ============================================================

export const maxDuration = 10;

import { rateLimit as _rateLimit } from "../_rateLimit.js";
import { setCors as _setCors, supabase as _supabase } from "../../lib/supabase.js";
import { resolveApiKey as _resolveApiKey } from "../../lib/api-key-auth.js";
import { log as _log } from "../../lib/log.js";

const OUTCOME_VALUES = new Set(["rdv_triggered", "rdv_signed", "rdv_no_show", "rdv_lost"]);
const MAX_LEAD_REF = 200;
const MAX_NOTE = 500;
const MAX_VALUE = 1_000_000_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validate(body) {
  if (!body || typeof body !== "object") return "Body must be an object";

  const ref = typeof body.external_lead_ref === "string" ? body.external_lead_ref.trim() : "";
  if (!ref) return "external_lead_ref is required";
  if (ref.length > MAX_LEAD_REF) return `external_lead_ref too long (max ${MAX_LEAD_REF} chars)`;

  if (!OUTCOME_VALUES.has(body.outcome)) {
    return `outcome must be one of : ${[...OUTCOME_VALUES].join(", ")}`;
  }

  if (body.message_id !== undefined && body.message_id !== null) {
    if (typeof body.message_id !== "string" || !UUID_RE.test(body.message_id)) {
      return "message_id must be a uuid string";
    }
  }

  if (body.value !== undefined && body.value !== null) {
    if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
      return "value must be a finite number";
    }
    if (Math.abs(body.value) > MAX_VALUE) {
      return `value out of range (|value| <= ${MAX_VALUE})`;
    }
  }

  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") return "note must be a string";
    if (body.note.length > MAX_NOTE) return `note too long (max ${MAX_NOTE} chars)`;
  }

  return null;
}

export default async function handler(req, res, deps) {
  const {
    rateLimit = _rateLimit,
    resolveApiKey = _resolveApiKey,
    setCors = _setCors,
    supabase = _supabase,
    log = _log,
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

  // Machine flow only — no session fallback. The brain UI calls /api/feedback
  // for the broader operator vocabulary ; this endpoint is the n8n surface.
  let apiKeyAuth;
  try {
    apiKeyAuth = await resolveApiKey(req);
  } catch (err) {
    res.status(err?.status || 403).json({ error: err?.error || "Auth failed" });
    return;
  }
  if (!apiKeyAuth) {
    res.status(401).json({ error: "x-api-key required" });
    return;
  }
  const persona = apiKeyAuth.persona;
  const client = apiKeyAuth.client;

  const validationError = validate(req.body);
  if (validationError) { res.status(400).json({ error: validationError }); return; }

  const body = req.body;
  const externalLeadRef = body.external_lead_ref.trim();
  const outcome = body.outcome;
  const messageId = body.message_id || null;
  const value = body.value === undefined || body.value === null ? null : body.value;
  const note = body.note ? body.note.slice(0, MAX_NOTE) : null;

  if (!supabase) {
    res.status(503).json({ error: "Database unavailable" });
    return;
  }

  // Resolve conversation by external_lead_ref. Must belong to the persona
  // pinned by the API key — a mismatch means the n8n template is wired to
  // the wrong key (or the lead was reused across personas).
  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .select("id, persona_id, client_id")
    .eq("external_lead_ref", externalLeadRef)
    .maybeSingle();

  if (convErr) {
    log("v2_feedback_conv_lookup_error", { error: convErr.message, external_lead_ref: externalLeadRef });
    res.status(500).json({ error: "db error" });
    return;
  }
  if (!conv) {
    res.status(404).json({
      error: "No conversation matches this external_lead_ref",
      external_lead_ref: externalLeadRef,
    });
    return;
  }
  if (conv.persona_id !== persona.id) {
    res.status(409).json({
      error: "external_lead_ref belongs to a different persona",
      expected_persona_id: persona.id,
    });
    return;
  }

  // business_outcomes.client_id is NOT NULL — pull from the conv if the
  // API key's owning client doesn't have an id (legacy keys from before the
  // client linkage was enforced). Conv.client_id is set at draft-time.
  const clientId = client?.id || conv.client_id || null;
  if (!clientId) {
    res.status(500).json({ error: "Cannot resolve client_id for outcome row" });
    return;
  }

  const insertRow = {
    conversation_id: conv.id,
    message_id: messageId,
    persona_id: persona.id,
    client_id: clientId,
    outcome,
    value,
    note,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("business_outcomes")
    .insert(insertRow)
    .select("id")
    .single();

  if (insertErr) {
    // 23505 = duplicate from the unique partial indexes (022 for rdv_signed,
    // 061 for rdv_triggered/no_show/lost). Translate to idempotent 200.
    if (insertErr.code === "23505") {
      const { data: existing } = await supabase
        .from("business_outcomes")
        .select("id")
        .eq("conversation_id", conv.id)
        .eq("outcome", outcome)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      log("v2_feedback_idempotent_hit", {
        persona: persona.id,
        conversation_id: conv.id,
        outcome,
        existing_id: existing?.id || null,
      });
      res.status(200).json({
        ok: true,
        outcome_id: existing?.id || null,
        conversation_id: conv.id,
        outcome,
        duplicate: true,
        ms: Date.now() - t0,
      });
      return;
    }

    // 23503 = FK violation, e.g. message_id points to a missing/cross-conv message.
    if (insertErr.code === "23503") {
      log("v2_feedback_fk_error", { error: insertErr.message, message_id: messageId });
      res.status(400).json({ error: "Invalid message_id (not found or wrong conversation)" });
      return;
    }

    log("v2_feedback_insert_error", {
      persona: persona.id,
      conversation_id: conv.id,
      error: insertErr.message,
      code: insertErr.code,
    });
    res.status(500).json({ error: "db error", detail: insertErr.message });
    return;
  }

  log("v2_feedback_completed", {
    persona: persona.id,
    conversation_id: conv.id,
    outcome,
    has_message_id: !!messageId,
    has_value: value !== null,
    ms: Date.now() - t0,
  });

  res.status(200).json({
    ok: true,
    outcome_id: inserted.id,
    conversation_id: conv.id,
    outcome,
    duplicate: false,
    ms: Date.now() - t0,
  });
}

// Exported for unit cover.
export { validate, OUTCOME_VALUES };

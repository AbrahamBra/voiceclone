// ============================================================
// API-key auth for the external draft surface (PR-1 V3.6.5).
//
// Coexists with the session/access-code auth in lib/supabase.js. Endpoints
// that accept BOTH user and machine traffic check the headers in this order :
//   1. x-api-key  → resolveApiKey() returns { persona, client } (machine flow)
//   2. x-session-token / x-access-code → authenticateRequest() (human flow)
//
// Raw keys are NEVER stored. Generation returns the raw value once at POST
// time (the brain page surfaces it once with a "copy now" CTA), then only
// the SHA-256 hash sits in persona_api_keys.key_hash.
//
// Rate-limit (V3.6.6) : two layers on x-api-key endpoints —
//   1. IP-based limiter in api/_rateLimit.js (20/min, shared across keys).
//   2. Per-key limiter in lib/_rateLimitApiKey.js (10/min + 500/day, scoped
//      to keyId). Enforced in api/v2/draft.js and api/v2/feedback.js
//      immediately after auth resolution.
// ============================================================

import crypto from "node:crypto";
import { supabase } from "./supabase.js";

const RAW_KEY_BYTES = 32; // 256 bits → ~43-char base64url, safe to paste in n8n
const RAW_KEY_PREFIX = "sk_";

/**
 * Hash a raw API key. SHA-256 hex, deterministic — used at both generation
 * (insert key_hash) and resolve (lookup key_hash) sides.
 */
export function hashApiKey(rawKey) {
  if (typeof rawKey !== "string" || !rawKey) return null;
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Mint a fresh raw key. Returns the bare string the operator must save.
 * Format : `sk_<base64url(32 random bytes)>` — prefix lets n8n logs and our
 * own logs grep for accidental key leaks ("sk_..." in stdout = alert).
 */
export function mintApiKey() {
  const raw = crypto.randomBytes(RAW_KEY_BYTES).toString("base64url");
  return `${RAW_KEY_PREFIX}${raw}`;
}

/**
 * Resolve an x-api-key header to a persona + owning client row.
 *
 * Returns null on any mismatch (missing header, unknown hash, revoked key,
 * persona deleted). Callers MUST translate null → 401 themselves so the
 * endpoint can fall back to session auth before rejecting.
 *
 * Touches last_used_at best-effort (fire-and-forget). The race where two
 * concurrent calls both write last_used_at is fine — last writer wins, the
 * field is informational not load-bearing.
 */
export async function resolveApiKey(req) {
  const rawKey = req.headers?.["x-api-key"];
  if (typeof rawKey !== "string" || !rawKey) return null;
  if (!supabase) return null;

  const keyHash = hashApiKey(rawKey);
  if (!keyHash) return null;

  // Single-row lookup keyed by the unique index on key_hash. Embed the
  // persona via PostgREST so we save a round-trip. Filter revoked rows
  // here rather than in the query so a revoked key returns null cleanly
  // (instead of leaking the persona via a separate revoked_at field).
  const { data: keyRow, error: keyErr } = await supabase
    .from("persona_api_keys")
    .select("id, persona_id, revoked_at, persona:personas(*)")
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (keyErr || !keyRow) return null;
  if (keyRow.revoked_at) return null;
  if (!keyRow.persona) return null;

  // Touch last_used_at best-effort. Don't await — auth latency stays tight.
  supabase
    .from("persona_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyRow.id)
    .then(() => {}, () => {});

  // Resolve owning client (for budget check + logUsage attribution).
  let client = null;
  if (keyRow.persona.client_id) {
    const { data: clientRow } = await supabase
      .from("clients")
      .select("*")
      .eq("id", keyRow.persona.client_id)
      .maybeSingle();
    if (clientRow) client = clientRow;
  }

  return {
    persona: keyRow.persona,
    client,
    keyId: keyRow.id,
    isAdmin: false,
  };
}

/**
 * Compose : try API-key auth first, fall back to session/access-code.
 *
 * Returns { persona, client, isAdmin, authMode } on success.
 * authMode = "api_key" | "session" — useful for log scoping.
 *
 * Throws { status, error } on failure (matches authenticateRequest contract).
 */
export async function authenticateApiOrSession(req, { authenticateRequest, getPersonaFromDb, personaId }) {
  // Machine-flow first : x-api-key takes precedence.
  const apiKeyAuth = await resolveApiKey(req);
  if (apiKeyAuth) {
    // The API key already pins the persona — caller MUST use this persona.id
    // and ignore any personaId in the body (or assert they match if both
    // provided). We don't enforce here because the caller (api/v2/draft)
    // does the comparison and returns a clean 400 on mismatch.
    return {
      persona: apiKeyAuth.persona,
      client: apiKeyAuth.client,
      isAdmin: false,
      authMode: "api_key",
      keyId: apiKeyAuth.keyId,
    };
  }

  // Human-flow fallback : session token or access code.
  const { client, isAdmin } = await authenticateRequest(req);

  // Personas are loaded by the caller in this branch — keep auth a simple
  // identity check, leave persona resolution to the route's existing logic.
  let persona = null;
  if (personaId && getPersonaFromDb) {
    persona = await getPersonaFromDb(personaId).catch(() => null);
  }

  return { persona, client, isAdmin, authMode: "session" };
}

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_CODE = process.env.ADMIN_CODE;
const SESSION_TTL_HOURS = 24;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — DB features disabled");
}

export const supabase = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

/**
 * Authenticate a request. Returns { client, isAdmin } or throws.
 *
 * Auth flow:
 * 1. Check x-session-token header (session-based auth, fast)
 * 2. Fall back to x-access-code header (login, creates session)
 */
export async function authenticateRequest(req) {
  // Try session token first (fast path)
  const sessionToken = req.headers["x-session-token"];
  if (sessionToken && supabase) {
    const { data: session } = await supabase
      .from("sessions")
      .select("client_id, expires_at")
      .eq("token", sessionToken)
      .single();

    if (session && new Date(session.expires_at) > new Date()) {
      const { data: client } = await supabase
        .from("clients").select("*").eq("id", session.client_id).single();
      if (client) return { client, isAdmin: client.access_code === "__admin__" };
    }
    // Invalid/expired session — fall through to access code
  }

  // Access code auth (login)
  const code = req.headers["x-access-code"];
  if (!code) throw { status: 401, error: "Access code required" };

  // Check admin — load admin client from DB for conversation persistence
  if (ADMIN_CODE && code === ADMIN_CODE) {
    if (supabase) {
      const { data: adminClient } = await supabase
        .from("clients").select("*").eq("access_code", "__admin__").single();
      if (adminClient) return { client: adminClient, isAdmin: true };
    }
    return { client: null, isAdmin: true };
  }

  // Check client in DB
  if (!supabase) throw { status: 500, error: "Database not configured" };

  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("access_code", code)
    .eq("is_active", true)
    .single();

  if (error || !data) throw { status: 403, error: "Invalid access code" };

  return { client: data, isAdmin: false };
}

/**
 * Create a session token for a client.
 * Returns { token, expires_at } or null if sessions table doesn't exist.
 */
export async function createSession(clientId) {
  if (!supabase || !clientId) return null;
  const token = randomUUID();
  const expires_at = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();

  try {
    await supabase.from("sessions").insert({ client_id: clientId, token, expires_at });
    // Cleanup expired sessions (opportunistic, non-blocking)
    supabase.rpc("cleanup_expired_sessions").catch(() => {});
    return { token, expires_at };
  } catch {
    return null; // sessions table may not exist yet
  }
}

/**
 * Check if client has budget remaining.
 * Returns { allowed, remaining_cents }.
 * Always allowed if client has their own API key.
 */
export function checkBudget(client) {
  if (!client) return { allowed: true, remaining_cents: Infinity }; // admin
  if (client.anthropic_api_key) return { allowed: true, remaining_cents: Infinity }; // own key
  const remaining = client.budget_cents - client.spent_cents;
  return { allowed: remaining > 0, remaining_cents: Math.max(0, remaining) };
}

/**
 * Get the Anthropic API key to use for a client.
 * Client's own key takes priority, then platform default.
 */
export function getApiKey(client) {
  if (client?.anthropic_api_key) return client.anthropic_api_key;
  return process.env.ANTHROPIC_API_KEY;
}

/**
 * Log API usage and increment client spend.
 */
// Pricing per model ($/MTok): { input, output, cache_read }
const MODEL_PRICING = {
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.00, cache_read: 0.08 },
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00, cache_read: 0.30 },
};
const DEFAULT_PRICING = MODEL_PRICING["claude-sonnet-4-20250514"];

export async function logUsage(clientId, personaId, inputTokens, outputTokens, { model, cacheRead = 0 } = {}) {
  if (!supabase || !clientId) return;

  const pricing = MODEL_PRICING[model] || DEFAULT_PRICING;
  // Cache read tokens are billed at 10% of input price
  const effectiveInput = inputTokens - cacheRead; // Non-cached input tokens
  const costCents = ((effectiveInput * pricing.input + cacheRead * pricing.cache_read + outputTokens * pricing.output) / 1_000_000) * 100;

  await supabase.from("usage_log").insert({
    client_id: clientId,
    persona_id: personaId,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_cents: costCents,
  });

  // Increment spent_cents
  const amount = Math.ceil(costCents);
  const { error: rpcError } = await supabase.rpc("increment_spent", { client_uuid: clientId, amount });
  if (rpcError) {
    // Fallback if RPC doesn't exist: read + write
    const { data } = await supabase.from("clients").select("spent_cents").eq("id", clientId).single();
    if (data) {
      await supabase.from("clients").update({ spent_cents: (data.spent_cents || 0) + amount }).eq("id", clientId);
    }
  }
}

/**
 * Check if a client has access to a persona (owner or shared).
 */
export async function hasPersonaAccess(clientId, personaId) {
  if (!supabase || !clientId || !personaId) return false;
  const { data: persona } = await supabase
    .from("personas").select("client_id").eq("id", personaId).single();
  if (persona?.client_id === clientId) return true;
  const { data: share } = await supabase
    .from("persona_shares").select("id")
    .eq("persona_id", personaId).eq("client_id", clientId).single();
  return !!share;
}

/**
 * CORS headers helper.
 * Restricts origin to known domains (Vercel preview + production).
 */
const ALLOWED_ORIGINS = new Set([
  "https://voiceclone-lake.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
]);

export function setCors(res, methods = "GET, POST, OPTIONS") {
  // Dynamic origin check — also allow Vercel preview deployments
  const origin = res.req?.headers?.origin || "";
  const isAllowed = ALLOWED_ORIGINS.has(origin)
    || origin.endsWith(".vercel.app");

  res.setHeader("Access-Control-Allow-Origin", isAllowed ? origin : "https://voiceclone-lake.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-access-code, x-session-token");
  if (isAllowed) res.setHeader("Vary", "Origin");
}

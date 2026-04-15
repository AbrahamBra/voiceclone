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
      if (client) return { client, isAdmin: false };
    }
    // Invalid/expired session — fall through to access code
  }

  // Access code auth (login)
  const code = req.headers["x-access-code"];
  if (!code) throw { status: 401, error: "Access code required" };

  // Check admin
  if (ADMIN_CODE && code === ADMIN_CODE) {
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
export async function logUsage(clientId, personaId, inputTokens, outputTokens) {
  if (!supabase || !clientId) return;

  // Sonnet pricing: $3/MTok input, $15/MTok output
  const costCents = ((inputTokens * 3 + outputTokens * 15) / 1_000_000) * 100;

  await supabase.from("usage_log").insert({
    client_id: clientId,
    persona_id: personaId,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_cents: costCents,
  });

  // Increment spent_cents
  await supabase.rpc("increment_spent", { client_uuid: clientId, amount: Math.ceil(costCents) })
    .then(() => {})
    .catch(async () => {
      // Fallback if RPC doesn't exist: read + write
      const { data } = await supabase.from("clients").select("spent_cents").eq("id", clientId).single();
      if (data) {
        await supabase.from("clients").update({ spent_cents: data.spent_cents + Math.ceil(costCents) }).eq("id", clientId);
      }
    });
}

/**
 * CORS headers helper.
 */
export function setCors(res, methods = "GET, POST, OPTIONS") {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-access-code, x-session-token");
}

// ============================================================
// CRUD for persona_api_keys (PR-1 V3.6.5).
//
// Endpoints :
//   GET    /api/v2/persona-api-keys?persona=<uuid>
//     → { keys: [{ id, label, created_at, last_used_at, revoked_at }] }
//     Raw key is NEVER returned on list — only at POST time.
//
//   POST   /api/v2/persona-api-keys
//     body: { persona_id, label? }
//     → { id, raw_key, label, created_at }
//     Raw key shown ONCE. Operator copies it into Breakcold/n8n credentials.
//
//   DELETE /api/v2/persona-api-keys?id=<uuid>
//     → { revoked: true, id }
//     Soft-delete via revoked_at = now(). Past usage logs survive.
//
// Auth : session or access-code (operator flow). The brain page UI calls
// these — never the n8n integration itself.
// ============================================================

export const maxDuration = 10;

import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../lib/supabase.js";
import { mintApiKey, hashApiKey } from "../../lib/api-key-auth.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LABEL_LEN = 80;
const PUBLIC_COLUMNS = "id, label, created_at, last_used_at, revoked_at";

export default async function handler(req, res, deps) {
  const {
    authenticateRequest = _authenticateRequest,
    hasPersonaAccess = _hasPersonaAccess,
    supabase = _supabase,
    setCors = _setCors,
  } = deps || {};

  setCors(res, "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const ctx = { supabase, hasPersonaAccess, client, isAdmin };

  if (req.method === "GET") return handleList(req, res, ctx);
  if (req.method === "POST") return handleCreate(req, res, ctx);
  if (req.method === "DELETE") return handleRevoke(req, res, ctx);
  res.status(405).json({ error: "Method not allowed" });
}

async function handleList(req, res, { supabase, hasPersonaAccess, client, isAdmin }) {
  const personaId = (req.query?.persona || "").trim();
  if (!personaId || !UUID_RE.test(personaId)) {
    res.status(400).json({ error: "persona query param required (uuid)" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, personaId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Surface revoked keys too — the operator wants to see "this key was
  // revoked on date X" in the panel rather than have them silently disappear.
  const { data, error } = await supabase
    .from("persona_api_keys")
    .select(PUBLIC_COLUMNS)
    .eq("persona_id", personaId)
    .order("created_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: "db error" });
    return;
  }
  res.status(200).json({ keys: data || [] });
}

async function handleCreate(req, res, { supabase, hasPersonaAccess, client, isAdmin }) {
  const body = req.body || {};
  const personaId = typeof body.persona_id === "string" ? body.persona_id.trim() : "";
  if (!personaId || !UUID_RE.test(personaId)) {
    res.status(400).json({ error: "persona_id is required (uuid)" });
    return;
  }
  let label = null;
  if (body.label !== undefined) {
    if (typeof body.label !== "string") {
      res.status(400).json({ error: "label must be a string" });
      return;
    }
    label = body.label.trim().slice(0, MAX_LABEL_LEN) || null;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, personaId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rawKey = mintApiKey();
  const keyHash = hashApiKey(rawKey);
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("persona_api_keys")
    .insert({ persona_id: personaId, key_hash: keyHash, label, created_at: now })
    .select(PUBLIC_COLUMNS)
    .single();

  if (error) {
    res.status(500).json({ error: "db error", detail: error.message });
    return;
  }

  // Raw key returned ONCE here. The brain page MUST surface it with a
  // "copy now, you won't see it again" warning — the column only stores
  // the hash, so a forgotten key is effectively unrecoverable (operator
  // revokes + creates a new one).
  res.status(201).json({
    id: data.id,
    raw_key: rawKey,
    label: data.label,
    created_at: data.created_at,
  });
}

async function handleRevoke(req, res, { supabase, hasPersonaAccess, client, isAdmin }) {
  const id = (req.query?.id || "").trim();
  if (!id || !UUID_RE.test(id)) {
    res.status(400).json({ error: "id query param required (uuid)" });
    return;
  }

  // Fetch the key to find its owning persona for the access check.
  const { data: keyRow } = await supabase
    .from("persona_api_keys")
    .select("id, persona_id, revoked_at")
    .eq("id", id)
    .maybeSingle();
  if (!keyRow) {
    res.status(404).json({ error: "key not found" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, keyRow.persona_id))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (keyRow.revoked_at) {
    res.status(200).json({ revoked: true, id, already_revoked: true });
    return;
  }

  const { error } = await supabase
    .from("persona_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    res.status(500).json({ error: "db error", detail: error.message });
    return;
  }
  res.status(200).json({ revoked: true, id });
}

// Propositions v2 — CRUD on the `proposition` table (migration 038).
//
// Endpoints:
//   GET  /api/v2/propositions?document=<uuid>&status=pending|accepted|...
//     → { propositions: [...] }
//   POST /api/v2/propositions
//     body: { action: 'accept'|'reject'|'revise', id: <uuid>,
//             user_note?: string, proposed_text?: string (required for revise) }
//     → { proposition: {...} }
//
// Single-file handler with a body-level `action` discriminator (rather than
// /api/v2/propositions/accept sub-paths) to keep Vercel routing trivial and
// serverless-function count small. Chunk 4 will split into a richer UI-facing
// mutation API (see plan tasks 4.3 / 4.4) once accept needs to patch prose
// and emit training examples.
//
// Auth: authenticateRequest + hasPersonaAccess, same pattern as api/v2/protocol.js.
// The `supabase` singleton uses the service-role key (per lib/supabase.js),
// which is required to write under the `service_role_all` RLS policy.
//
// Handler accepts an optional `deps` 3rd argument for test injection. In
// production Vercel calls handler(req, res) and real imports are used.

export const maxDuration = 15;

import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../lib/supabase.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_VALUES = new Set(["pending", "accepted", "rejected", "revised", "merged"]);
const ACTIONS = new Set(["accept", "reject", "revise"]);

const PROPOSITION_COLUMNS =
  "id, document_id, source, source_ref, source_refs, count, intent, " +
  "target_kind, target_section_id, proposed_text, rationale, confidence, " +
  "status, user_note, created_at, resolved_at";

export default async function handler(req, res, deps) {
  const {
    authenticateRequest = _authenticateRequest,
    hasPersonaAccess = _hasPersonaAccess,
    supabase = _supabase,
    setCors = _setCors,
  } = deps || {};

  setCors(res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const ctx = { supabase, hasPersonaAccess, client, isAdmin };
  if (req.method === "GET") return handleList(req, res, ctx);
  return handleMutate(req, res, ctx);
}

async function handleList(req, res, { supabase, hasPersonaAccess, client, isAdmin }) {
  const documentId = req.query?.document;
  const status = req.query?.status;

  if (!documentId || !UUID_RE.test(documentId)) {
    res.status(400).json({ error: "document is required (uuid)" });
    return;
  }
  if (status && !STATUS_VALUES.has(status)) {
    res.status(400).json({ error: "invalid status" });
    return;
  }

  const personaId = await documentPersonaId(supabase, documentId);
  if (!personaId) {
    res.status(404).json({ error: "document not found" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, personaId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  let q = supabase
    .from("proposition")
    .select(PROPOSITION_COLUMNS)
    .eq("document_id", documentId)
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) {
    res.status(500).json({ error: "db error" });
    return;
  }
  res.status(200).json({ propositions: data || [] });
}

async function handleMutate(req, res, { supabase, hasPersonaAccess, client, isAdmin }) {
  const body = req.body || {};
  const { action, id, user_note, proposed_text } = body;

  if (!ACTIONS.has(action)) {
    res.status(400).json({ error: "action must be accept|reject|revise" });
    return;
  }
  if (!id || typeof id !== "string" || !UUID_RE.test(id)) {
    res.status(400).json({ error: "id is required (uuid)" });
    return;
  }
  if (action === "revise") {
    if (typeof proposed_text !== "string" || !proposed_text.trim()) {
      res.status(400).json({ error: "proposed_text is required for revise" });
      return;
    }
  }
  if (user_note !== undefined && typeof user_note !== "string") {
    res.status(400).json({ error: "user_note must be a string" });
    return;
  }

  const { data: prop, error: propErr } = await supabase
    .from("proposition")
    .select("id, document_id, status")
    .eq("id", id)
    .single();
  if (propErr || !prop) {
    res.status(404).json({ error: "proposition not found" });
    return;
  }

  const personaId = await documentPersonaId(supabase, prop.document_id);
  if (!personaId) {
    res.status(404).json({ error: "document not found" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, personaId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const nowIso = new Date().toISOString();
  const update = { resolved_at: nowIso };
  if (action === "accept") update.status = "accepted";
  else if (action === "reject") update.status = "rejected";
  else {
    update.status = "revised";
    update.proposed_text = proposed_text.trim();
  }
  if (user_note !== undefined) update.user_note = user_note;

  const { data, error } = await supabase
    .from("proposition")
    .update(update)
    .eq("id", id)
    .select(PROPOSITION_COLUMNS)
    .single();

  if (error) {
    res.status(500).json({ error: "db error" });
    return;
  }
  res.status(200).json({ proposition: data });
}

async function documentPersonaId(sb, documentId) {
  const { data, error } = await sb
    .from("protocol_document")
    .select("owner_id, owner_kind")
    .eq("id", documentId)
    .single();
  if (error || !data || data.owner_kind !== "persona") return null;
  return data.owner_id;
}

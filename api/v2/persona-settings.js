// POST /api/v2/persona-settings
//   body: { persona_id, auto_merge_cosine }
//   → { ok: true, auto_merge_cosine }
//
// Met à jour les réglages persona-level (actuellement : auto_merge_cosine).
// Auth : authenticateRequest + hasPersonaAccess.

export const maxDuration = 5;

import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../lib/supabase.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res, deps) {
  const {
    authenticateRequest = _authenticateRequest,
    hasPersonaAccess = _hasPersonaAccess,
    supabase = _supabase,
    setCors = _setCors,
  } = deps || {};

  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { persona_id, auto_merge_cosine } = req.body || {};
  if (!persona_id || !UUID_RE.test(persona_id)) {
    res.status(400).json({ error: "persona_id (uuid) required in body" });
    return;
  }
  const cos = Number(auto_merge_cosine);
  if (!Number.isFinite(cos) || cos < 0.65 || cos > 1.0) {
    res.status(400).json({ error: "auto_merge_cosine must be a number in [0.65, 1.0]" });
    return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, persona_id))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rounded = Math.round(cos * 1000) / 1000;
  const { error } = await supabase
    .from("personas")
    .update({ auto_merge_cosine: rounded })
    .eq("id", persona_id);
  if (error) {
    res.status(500).json({ error: "update failed", detail: error.message });
    return;
  }

  res.status(200).json({ ok: true, auto_merge_cosine: rounded });
}

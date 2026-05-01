// POST /api/account/delete — minimal RGPD "right of withdrawal" endpoint.
//
// Soft-deletes the authenticated client's account :
//   - clients.is_active = false  (login lockout via partial index)
//   - personas.is_active = false on all personas owned by this client
//   - PII scrubbed on clients : name → "[deleted-<short>]", api keys → null
//
// Hard delete + full RGPD data export are out of scope for the beta : they
// require a cascade plan across usage_log/learning_events/feedback_events
// (no FK ON DELETE CASCADE on those today) and a documented dump format.
// Tracked as Phase 2 work.
//
// Auth : x-session-token or x-access-code (same as the rest of the app).
// Admin (`__admin__` access code) cannot self-delete via this endpoint —
// that would brick the platform.
//
// Body :
//   { confirm_access_code: string }   # echo of the user's own access_code
//                                      # safety against accidental / CSRF calls
//
// Returns :
//   { ok: true, deactivated_at: string, personas_deactivated: number }
//
// Handler accepts an optional `deps` 3rd argument for test injection.

import {
  authenticateRequest as _authenticateRequest,
  supabase as _supabase,
  setCors as _setCors,
} from "../../lib/supabase.js";

export default async function handler(req, res, deps) {
  const {
    authenticateRequest = _authenticateRequest,
    supabase = _supabase,
    setCors = _setCors,
  } = deps || {};

  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  if (isAdmin) {
    res.status(403).json({ error: "Admin account cannot self-delete" });
    return;
  }

  const body = req.body || {};
  const echo = typeof body.confirm_access_code === "string" ? body.confirm_access_code : "";
  if (!echo || echo !== client.access_code) {
    res.status(400).json({ error: "confirm_access_code must match your access code" });
    return;
  }

  // Deactivate personas first — if this fails we still want the client lockout
  // to apply (better leave orphan personas inactive than leave a live login).
  const { data: personas, error: pErr } = await supabase
    .from("personas")
    .update({ is_active: false })
    .eq("client_id", client.id)
    .eq("is_active", true)
    .select("id");

  if (pErr) {
    res.status(500).json({ error: "Failed to deactivate personas: " + pErr.message });
    return;
  }

  const personasDeactivated = (personas || []).length;
  const shortId = client.id.slice(0, 8);
  const deletedName = `[deleted-${shortId}]`;

  const { error: cErr } = await supabase
    .from("clients")
    .update({
      is_active: false,
      name: deletedName,
      anthropic_api_key: null,
      scraping_api_key: null,
    })
    .eq("id", client.id);

  if (cErr) {
    res.status(500).json({ error: "Failed to deactivate client: " + cErr.message });
    return;
  }

  res.json({
    ok: true,
    deactivated_at: new Date().toISOString(),
    personas_deactivated: personasDeactivated,
  });
}

// POST /api/v2/protocol/publish-active
//   body: { personaId: <uuid> }
//   → { narrative, brief, version, version_old, accepted_count, rejected_count, revised_count, publish_event_id }
//
// Pragmatic publish flow that matches the actual data model :
//   - Acceptance patches the active doc directly (no draft created).
//   - This endpoint generates the narrative from currently-resolved props,
//     bumps the active doc's version, and records a publish_event row.
//
// Different from /api/v2/protocol/publish (which expects a pre-existing draft
// to flip — never used by the UI today). This endpoint is the one the UI
// button actually calls.
//
// Auth pattern : identique au reste du dossier api/v2/protocol/.

export const maxDuration = 20;

import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../../lib/supabase.js";
import { generateNarrative as _generateNarrative } from "../../../lib/protocol-v2-changelog-narrator.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res, deps) {
  const {
    authenticateRequest = _authenticateRequest,
    hasPersonaAccess = _hasPersonaAccess,
    supabase = _supabase,
    setCors = _setCors,
    generateNarrative = _generateNarrative,
  } = deps || {};

  setCors(res, "POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const body = req.body || {};
  const { personaId } = body;
  if (!personaId || typeof personaId !== "string" || !UUID_RE.test(personaId)) {
    res.status(400).json({ error: "personaId is required (uuid)" }); return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" }); return;
  }

  if (!isAdmin && !(await hasPersonaAccess(client?.id, personaId))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  // 1. Find active doc for persona
  const { data: doc, error: docErr } = await supabase
    .from("protocol_document")
    .select("id, version, persona_name:owner_id")
    .eq("owner_kind", "persona")
    .eq("owner_id", personaId)
    .eq("status", "active")
    .maybeSingle();
  if (docErr || !doc) {
    res.status(404).json({ error: "no active document for this persona" }); return;
  }

  // 2. Find resolved props NOT yet covered by a prior publish_event on this doc
  const { data: priorEvents } = await supabase
    .from("protocol_publish_event")
    .select("accepted_proposition_ids, rejected_proposition_ids, revised_proposition_ids")
    .eq("document_id", doc.id);
  const alreadyPublished = new Set();
  for (const ev of priorEvents || []) {
    for (const id of ev.accepted_proposition_ids || []) alreadyPublished.add(id);
    for (const id of ev.rejected_proposition_ids || []) alreadyPublished.add(id);
    for (const id of ev.revised_proposition_ids || []) alreadyPublished.add(id);
  }

  const { data: propsAll } = await supabase
    .from("proposition")
    .select("id, status, intent, target_kind, proposed_text, rationale, user_note")
    .eq("document_id", doc.id)
    .in("status", ["accepted", "rejected", "revised"]);

  const fresh = (propsAll || []).filter(p => !alreadyPublished.has(p.id));
  const accepted = fresh.filter(p => p.status === "accepted");
  const rejected = fresh.filter(p => p.status === "rejected");
  const revised  = fresh.filter(p => p.status === "revised");

  if (fresh.length === 0) {
    res.status(409).json({
      error: "no_fresh_propositions",
      message: "All resolved propositions on this doc are already covered by a prior publish event.",
    });
    return;
  }

  // 3. Get persona name for narrative tone
  let personaName = "le clone";
  const { data: pers } = await supabase
    .from("personas").select("name, slug").eq("id", personaId).maybeSingle();
  if (pers?.name) personaName = pers.name;
  else if (pers?.slug) personaName = pers.slug;

  const oldVersion = doc.version;
  const newVersion = oldVersion + 1;

  // 4. Generate narrative
  let narrative = null, brief = null;
  try {
    const out = await generateNarrative({
      client,
      accepted, rejected, revised,
      personaName,
      fromVersion: oldVersion,
      toVersion: newVersion,
    });
    narrative = out?.narrative ?? null;
    brief = out?.brief ?? null;
  } catch (err) {
    // Non-fatal — publish event will still be recorded.
    narrative = null;
    brief = null;
  }

  // 5. Bump doc version
  const { error: bumpErr } = await supabase
    .from("protocol_document")
    .update({ version: newVersion, updated_at: new Date().toISOString() })
    .eq("id", doc.id);
  if (bumpErr) {
    res.status(500).json({ error: "version bump failed: " + bumpErr.message }); return;
  }

  // 6. Insert publish_event row
  const { data: ev, error: evErr } = await supabase
    .from("protocol_publish_event")
    .insert({
      document_id: doc.id,
      archived_document_id: null, // no archive — same doc bumps in place
      version: newVersion,
      summary_narrative: narrative,
      summary_brief: brief,
      accepted_proposition_ids: accepted.map(p => p.id),
      rejected_proposition_ids: rejected.map(p => p.id),
      revised_proposition_ids: revised.map(p => p.id),
      stats_migrated: 0,
      published_by: client?.id || null,
    })
    .select("id")
    .maybeSingle();
  if (evErr) {
    // Roll back version bump for consistency? Not destructive enough to bother.
    res.status(500).json({ error: "publish_event insert failed: " + evErr.message }); return;
  }

  res.status(200).json({
    narrative,
    brief,
    version: newVersion,
    version_old: oldVersion,
    accepted_count: accepted.length,
    rejected_count: rejected.length,
    revised_count: revised.length,
    publish_event_id: ev?.id || null,
  });
}

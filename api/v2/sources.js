// GET /api/v2/sources?persona=<uuid>
//   → { persona_id, docs: [...], playbooks: [...] }
//
// docs    : protocol_import_batch rows pour le document actif du persona
//           (chaque batch = 1 invocation /api/v2/protocol/import-doc).
//           Champs : filename, doc_kind, chunks_processed, propositions_created,
//                    propositions_merged, identity_chars_added, imported_at.
//
// playbooks : protocol_document rows owner_id=<persona> AND source_core IS NOT NULL.
//             Représente les playbooks source-specific (mig 055).
//             Champs : id, name (=source_core), status, version, created_at.
//
// Auth + lookup protocol_document = mêmes invariants que /api/v2/brain-status.

export const maxDuration = 10;

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

  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const personaId = (req.query?.persona || "").trim();
  if (!personaId) {
    res.status(400).json({ error: "persona query param required" });
    return;
  }
  if (!UUID_RE.test(personaId)) {
    res.status(400).json({ error: "persona must be a valid UUID" });
    return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, personaId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Active doc (global, source_core IS NULL) — pour scoper les import batches
  const { data: doc, error: docErr } = await supabase
    .from("protocol_document")
    .select("id")
    .eq("owner_kind", "persona")
    .eq("owner_id", personaId)
    .eq("status", "active")
    .is("source_core", null)
    .maybeSingle();
  if (docErr) {
    res.status(500).json({ error: "protocol_document lookup failed" });
    return;
  }

  // Import batches du document global (pas des playbooks)
  let docs = [];
  if (doc) {
    const batchRes = await supabase
      .from("protocol_import_batch")
      .select("id, doc_filename, doc_kind, chunks_processed, candidates_total, propositions_created, propositions_merged, identity_appended, identity_chars_added, created_at")
      .eq("document_id", doc.id)
      .order("created_at", { ascending: false });
    if (batchRes.error) {
      res.status(500).json({ error: "protocol_import_batch query failed" });
      return;
    }
    docs = (batchRes.data || []).map(b => ({
      id: b.id,
      filename: b.doc_filename || "—",
      doc_kind: b.doc_kind,
      chunks_processed: b.chunks_processed,
      candidates_total: b.candidates_total,
      propositions_created: b.propositions_created,
      propositions_merged: b.propositions_merged,
      identity_appended: b.identity_appended,
      identity_chars_added: b.identity_chars_added,
      imported_at: b.created_at,
    }));
  }

  // Playbooks (protocol_document avec source_core != NULL pour ce persona)
  const pbRes = await supabase
    .from("protocol_document")
    .select("id, source_core, status, version, created_at")
    .eq("owner_kind", "persona")
    .eq("owner_id", personaId)
    .not("source_core", "is", null)
    .order("created_at", { ascending: false });
  if (pbRes.error) {
    res.status(500).json({ error: "playbook query failed" });
    return;
  }
  const playbooks = (pbRes.data || []).map(p => ({
    id: p.id,
    name: p.source_core,
    status: p.status,
    version: p.version,
    created_at: p.created_at,
  }));

  res.status(200).json({
    persona_id: personaId,
    docs,
    playbooks,
  });
}

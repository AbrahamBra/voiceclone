// GET /api/v2/brain-status?persona=<uuid>
//   → { persona_id, document_id, counts: { contradictions_open, propositions_pending,
//                              propositions_pending_doc, propositions_pending_chat,
//                              auto_merged, doctrine_sections_filled,
//                              doctrine_sections_total } }
//
// Single-fetch endpoint pour le status banner de la page brain V1.
// Lit en parallèle les compteurs depuis 4 tables :
//   - proposition (status='pending', split par source group)
//   - proposition_contradiction (status='open')
//   - proposition_merge_history (reverted_at IS NULL)
//   - protocol_section (prose != '')
//
// Auth : authenticateRequest + hasPersonaAccess (mêmes que /api/v2/propositions).
// Handler accepte un `deps` 3e arg pour test injection.

export const maxDuration = 10;

import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../lib/supabase.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Source value → 'doc' | 'chat' bucket. Sources non listées sont absorbées
// dans 'doc' par défaut (manual / agency_supervision / analytics_cron).
// Aligné sur proposition.source CHECK list (mig 038 + 070).
const CHAT_SOURCES = new Set([
  "feedback_event",
  "learning_event",
  "chat_rewrite",
  "client_validation",
]);

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

  // Active protocol_document — global doc seulement (source_core IS NULL).
  // Un persona peut avoir plusieurs docs actifs : 1 global + N playbooks
  // source-specific (mig 055). Le brain page V1 affiche la doctrine globale.
  // Sans le filtre source_core, .maybeSingle() throw "more than 1 row" → 500.
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
  if (!doc) {
    res.status(404).json({ error: "no active protocol_document for this persona" });
    return;
  }
  const documentId = doc.id;

  // 4 reads en parallèle. Volumes faibles (max ~250 propositions, ~50
  // contradictions, ~100 merges, 7 sections) → on tire les rows et on
  // compte côté JS plutôt que d'utiliser { count: 'exact', head: true }
  // qui complique la stub Supabase côté tests.
  const [propsRes, contraRes, mergesRes, sectionsRes] = await Promise.all([
    supabase
      .from("proposition")
      .select("id, source, status")
      .eq("document_id", documentId)
      .eq("status", "pending"),
    supabase
      .from("proposition_contradiction")
      .select("id")
      .eq("persona_id", personaId)
      .eq("status", "open"),
    supabase
      .from("proposition_merge_history")
      .select("id")
      .eq("persona_id", personaId)
      .is("reverted_at", null),
    supabase
      .from("protocol_section")
      .select("id, prose")
      .eq("document_id", documentId),
  ]);

  if (propsRes.error || contraRes.error || mergesRes.error || sectionsRes.error) {
    res.status(500).json({
      error: "count query failed",
      detail: {
        propositions: propsRes.error?.message,
        contradictions: contraRes.error?.message,
        merges: mergesRes.error?.message,
        sections: sectionsRes.error?.message,
      },
    });
    return;
  }

  const propRows = propsRes.data || [];
  let pendingDoc = 0;
  let pendingChat = 0;
  for (const r of propRows) {
    if (CHAT_SOURCES.has(r.source)) pendingChat++;
    else pendingDoc++;
  }

  const sections = sectionsRes.data || [];
  const sectionsFilled = sections.filter(s => (s.prose || "").trim().length > 0).length;

  res.status(200).json({
    persona_id: personaId,
    document_id: documentId,
    counts: {
      contradictions_open: (contraRes.data || []).length,
      propositions_pending: propRows.length,
      propositions_pending_doc: pendingDoc,
      propositions_pending_chat: pendingChat,
      auto_merged: (mergesRes.data || []).length,
      doctrine_sections_filled: sectionsFilled,
      doctrine_sections_total: sections.length,
    },
  });
}

// POST /api/v2/propositions-batch
//   body: { persona: <uuid>,
//           filters: { target_kind?, confidence_min: 0.50..1.00 },
//           action: 'accept' | 'reject',
//           dry_run?: boolean }
//
// Unifie batch-preview + batch-apply (vs spec V1 qui les séparait).
//
// dry_run=true   → { matched: N, sample: proposition[<=5] } sans muter.
// action=reject  → bulk update status='rejected', resolved_at=now() en 1 SQL.
//                  Retourne { applied: N, failed: 0 }.
// action=accept  → 501 Not Implemented en V1. Le batch-accept implique
//                  des patches prose concurrentiels sur protocol_section
//                  (non-trivial à faire de manière atomique). User doit
//                  accepter individuellement via POST /api/v2/propositions
//                  action=accept. Batch accept arrive V1.1.
//
// Auth + lookup protocol_document = mêmes invariants que /api/v2/brain-status.

export const maxDuration = 30;

import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../lib/supabase.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["accept", "reject"]);
const TARGET_KINDS = new Set(["identity", "icp_patterns", "scoring", "process",
                              "templates", "hard_rules", "errors", "custom"]);

const PROPOSITION_COLUMNS_SAMPLE =
  "id, target_kind, proposed_text, confidence, source, count, created_at";

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

  const body = req.body || {};
  const personaId = (body.persona || "").trim();
  const filters = body.filters || {};
  const action = body.action;
  const dryRun = body.dry_run === true;

  if (!UUID_RE.test(personaId)) {
    res.status(400).json({ error: "persona must be a valid UUID" });
    return;
  }
  if (!ACTIONS.has(action)) {
    res.status(400).json({ error: "action must be accept or reject" });
    return;
  }
  if (filters.target_kind && !TARGET_KINDS.has(filters.target_kind)) {
    res.status(400).json({ error: "filters.target_kind invalid" });
    return;
  }
  const confMin = Number(filters.confidence_min);
  if (!Number.isFinite(confMin) || confMin < 0 || confMin > 1) {
    res.status(400).json({ error: "filters.confidence_min must be a number in [0, 1]" });
    return;
  }

  // Auth
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

  // Resolve active document
  const { data: doc, error: docErr } = await supabase
    .from("protocol_document")
    .select("id")
    .eq("owner_kind", "persona")
    .eq("owner_id", personaId)
    .eq("status", "active")
    .maybeSingle();
  if (docErr) {
    res.status(500).json({ error: "protocol_document lookup failed" });
    return;
  }
  if (!doc) {
    res.status(404).json({ error: "no active protocol_document for this persona" });
    return;
  }

  // Build the matching query (status='pending' + filters)
  let q = supabase
    .from("proposition")
    .select(PROPOSITION_COLUMNS_SAMPLE)
    .eq("document_id", doc.id)
    .eq("status", "pending")
    .gte("confidence", confMin);
  if (filters.target_kind) q = q.eq("target_kind", filters.target_kind);

  const { data: matchingProps, error: matchErr } = await q;
  if (matchErr) {
    res.status(500).json({ error: "matching query failed", detail: matchErr.message });
    return;
  }

  const matched = matchingProps || [];

  // ── Dry run : preview matched + sample, no mutation ──
  if (dryRun) {
    const sample = matched.slice(0, 5);
    res.status(200).json({
      matched: matched.length,
      sample,
    });
    return;
  }

  // ── Batch accept : 501 Not Implemented (V1) ──
  if (action === "accept") {
    res.status(501).json({
      error: "batch accept not implemented in V1 — accept individually via POST /api/v2/propositions",
      hint: "use single accept (button ✓) per proposition. Batch accept arrives V1.1.",
    });
    return;
  }

  // ── Batch reject : bulk update ──
  if (matched.length === 0) {
    res.status(200).json({ applied: 0, failed: 0 });
    return;
  }

  let updateQ = supabase
    .from("proposition")
    .update({ status: "rejected", resolved_at: new Date().toISOString() })
    .eq("document_id", doc.id)
    .eq("status", "pending")
    .gte("confidence", confMin);
  if (filters.target_kind) updateQ = updateQ.eq("target_kind", filters.target_kind);

  const { error: updateErr } = await updateQ;
  if (updateErr) {
    res.status(500).json({ error: "bulk update failed", detail: updateErr.message });
    return;
  }

  res.status(200).json({
    applied: matched.length,
    failed: 0,
  });
}

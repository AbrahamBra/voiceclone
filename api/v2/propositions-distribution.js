// GET /api/v2/propositions-distribution?persona=<uuid>
//   → { persona_id, distribution: {
//        all: [[1.00, n], [0.95, n], ..., [0.50, n]],
//        identity: [...], icp_patterns: [...], ..., custom: [...]
//      } }
//
// Distribution cumulative descendante : count[B] = nombre de props pending
// avec confidence >= B. 11 buckets verrouillés de 1.00 à 0.50 par 0.05.
// Permet à BatchBar côté client de calculer matched = bucket[filter] sans
// re-fetch sur chaque move-slider.
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

const BUCKETS = [1.00, 0.95, 0.90, 0.85, 0.80, 0.75, 0.70, 0.65, 0.60, 0.55, 0.50];
const TARGET_KINDS = ["identity", "icp_patterns", "scoring", "process",
                      "templates", "hard_rules", "errors", "custom"];

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

  // Global doc seulement (mig 055 : source_core != NULL = playbook source-specific).
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

  const propsRes = await supabase
    .from("proposition")
    .select("id, target_kind, confidence")
    .eq("document_id", doc.id)
    .eq("status", "pending");

  if (propsRes.error) {
    res.status(500).json({ error: "proposition query failed", detail: propsRes.error.message });
    return;
  }

  const rows = propsRes.data || [];

  // Init : tous les kinds + 'all', tous les buckets à 0.
  const distribution = { all: BUCKETS.map(b => [b, 0]) };
  for (const k of TARGET_KINDS) distribution[k] = BUCKETS.map(b => [b, 0]);

  for (const row of rows) {
    const conf = Number(row.confidence);
    if (!Number.isFinite(conf)) continue;
    const kind = TARGET_KINDS.includes(row.target_kind) ? row.target_kind : null;
    for (let i = 0; i < BUCKETS.length; i++) {
      const bMin = BUCKETS[i];
      if (conf >= bMin) {
        distribution.all[i][1]++;
        if (kind) distribution[kind][i][1]++;
      }
    }
  }

  res.status(200).json({
    persona_id: personaId,
    distribution,
  });
}

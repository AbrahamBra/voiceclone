// Protocol v2 — list import batches for a persona's protocol document.
//
// GET /api/v2/protocol/import-batches?persona=<uuid>&limit=20
//   → {
//       batches: [{
//         id, doc_filename, doc_kind,
//         identity_appended, identity_chars_added,
//         chunks_processed, candidates_total,
//         propositions_created, propositions_merged, silenced,
//         created_at,
//         pending_count, accepted_count, rejected_count,  // resolved status of the props
//         overlap_with: [<batch_id>, ...]                 // other batches whose props this batch's props were merged into / from
//       }, ...]
//     }
//
// Powers the "Calibrage" tab in ProtocolPanel : surfaces what each
// uploaded doc produced and where there's overlap with other docs (so
// the user can spot when two docs say the same thing — coherent — or
// contradict — to flag manually).
//
// Auth pattern : authenticateRequest + hasPersonaAccess (matches
// /api/v2/protocol.js).

export const maxDuration = 15;

import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../../lib/supabase.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export default async function handler(req, res, deps) {
  const {
    authenticateRequest = _authenticateRequest,
    hasPersonaAccess = _hasPersonaAccess,
    supabase = _supabase,
    setCors = _setCors,
  } = deps || {};

  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "GET") {
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

  const personaId = req.query?.persona;
  if (!personaId) {
    res.status(400).json({ error: "persona is required" });
    return;
  }
  if (!isAdmin && !(await hasPersonaAccess(client?.id, personaId))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rawLimit = parseInt(req.query?.limit || `${DEFAULT_LIMIT}`, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT) : DEFAULT_LIMIT;

  // Resolve persona → active GLOBAL protocol_document.
  const { data: doc } = await supabase
    .from("protocol_document")
    .select("id")
    .eq("owner_kind", "persona")
    .eq("owner_id", personaId)
    .eq("status", "active")
    .is("source_core", null)
    .limit(1)
    .maybeSingle();
  if (!doc?.id) {
    res.status(200).json({ batches: [] });
    return;
  }

  // Pull recent batches.
  const { data: batches, error: bErr } = await supabase
    .from("protocol_import_batch")
    .select("*")
    .eq("document_id", doc.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (bErr) {
    res.status(500).json({ error: "Failed to load batches" });
    return;
  }

  if (!batches || batches.length === 0) {
    res.status(200).json({ batches: [] });
    return;
  }

  // For each batch, hydrate propositions (status + overlap with other batches).
  // We do this in one query covering all batches, then bucket client-side.
  const batchIds = batches.map((b) => b.id);
  const { data: props } = await supabase
    .from("proposition")
    .select("id, source_ref, source_refs, status, target_kind")
    .eq("document_id", doc.id)
    .in("source_ref", batchIds);

  /** @type {Record<string, {pending:number, accepted:number, rejected:number, revised:number, merged:number, overlapSet:Set<string>}>} */
  const stats = {};
  for (const id of batchIds) {
    stats[id] = {
      pending: 0,
      accepted: 0,
      rejected: 0,
      revised: 0,
      merged: 0,
      overlapSet: new Set(),
    };
  }

  for (const p of props || []) {
    const bucket = stats[p.source_ref];
    if (!bucket) continue;
    bucket[p.status] = (bucket[p.status] || 0) + 1;
    for (const ref of p.source_refs || []) {
      if (ref && ref !== p.source_ref && batchIds.includes(ref)) {
        bucket.overlapSet.add(ref);
      }
    }
  }

  const enriched = batches.map((b) => ({
    ...b,
    pending_count: stats[b.id]?.pending || 0,
    accepted_count: stats[b.id]?.accepted || 0,
    rejected_count: stats[b.id]?.rejected || 0,
    overlap_with: Array.from(stats[b.id]?.overlapSet || []),
  }));

  res.status(200).json({ batches: enriched });
}

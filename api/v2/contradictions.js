// GET /api/v2/contradictions?persona=<uuid>&status=open|punted|resolved
//   → { contradictions: [{ id, kind, cosine, reason, status, detected_at,
//                          resolved_at?, resolved_action?, resolved_note?,
//                          a: { id, text, count, intent, confidence, sources, source } | null,
//                          b: { id, text, count, intent, confidence, sources, source } | null
//                        }] }
//
// Default status=open. Sort par cosine DESC (les paires les plus
// sémantiquement proches en haut — celles où la contradiction est la
// plus crédible).
//
// 2 reads :
//   1. proposition_contradiction filtré par persona + status, sort cosine DESC.
//   2. proposition WHERE id IN (a_id ∪ b_id) en 1 batch.
// Join client-side (plus simple à tester que .select('*, a:proposition!fk(...)')).
//
// Si une proposition référencée a été hard-deletée (cas edge), on retourne
// la contradiction avec a/b = null plutôt que de 500. Le frontend peut
// décider d'afficher "(supprimé)" ou de cacher la card.

export const maxDuration = 10;

import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../lib/supabase.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUS = new Set(["open", "punted", "resolved"]);

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
  if (!personaId || !UUID_RE.test(personaId)) {
    res.status(400).json({ error: "persona query param required (uuid)" });
    return;
  }

  const status = (req.query?.status || "open").trim();
  if (!VALID_STATUS.has(status)) {
    res.status(400).json({ error: `status must be one of: ${[...VALID_STATUS].join(", ")}` });
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

  // 1. Fetch contradictions.
  const { data: contras, error: cErr } = await supabase
    .from("proposition_contradiction")
    .select("id, kind, cosine, reason, status, detected_at, resolved_at, resolved_action, resolved_note, proposition_a_id, proposition_b_id")
    .eq("persona_id", personaId)
    .eq("status", status)
    .order("cosine", { ascending: false });
  if (cErr) {
    res.status(500).json({ error: "contradictions query failed", detail: cErr.message });
    return;
  }
  const rows = contras || [];
  if (rows.length === 0) {
    res.status(200).json({ contradictions: [] });
    return;
  }

  // 2. Fetch all referenced propositions in 1 batch.
  const propIds = [...new Set(rows.flatMap(r => [r.proposition_a_id, r.proposition_b_id]))];
  const { data: propsRaw, error: pErr } = await supabase
    .from("proposition")
    .select("id, proposed_text, count, intent, confidence, source, provenance")
    .in("id", propIds);
  if (pErr) {
    res.status(500).json({ error: "proposition lookup failed", detail: pErr.message });
    return;
  }
  const propsById = new Map((propsRaw || []).map(p => [p.id, p]));

  const contradictions = rows.map(r => ({
    id: r.id,
    kind: r.kind,
    cosine: Number(r.cosine),
    reason: r.reason,
    status: r.status,
    detected_at: r.detected_at,
    resolved_at: r.resolved_at,
    resolved_action: r.resolved_action,
    resolved_note: r.resolved_note,
    a: shapeProp(propsById.get(r.proposition_a_id)),
    b: shapeProp(propsById.get(r.proposition_b_id)),
  }));

  res.status(200).json({ contradictions });
}

function shapeProp(p) {
  if (!p) return null;
  return {
    id: p.id,
    text: p.proposed_text,
    count: p.count,
    intent: p.intent,
    confidence: p.confidence != null ? Number(p.confidence) : null,
    source: p.source,
    sources: extractSources(p.provenance),
  };
}

function extractSources(provenance) {
  if (!provenance || typeof provenance !== "object") return [];
  if (Array.isArray(provenance.sources)) return provenance.sources;
  // mig 070 : provenance.playbook_sources is an array of objects.
  // We surface a flat array of human-readable labels for the UI.
  if (Array.isArray(provenance.playbook_sources)) {
    return provenance.playbook_sources.map(s => {
      const parts = [];
      if (s.source_core) parts.push(s.source_core);
      if (s.toggle_idx != null) parts.push(`T${s.toggle_idx}`);
      if (s.toggle_title) parts.push(s.toggle_title);
      return parts.join(" / ");
    });
  }
  return [];
}

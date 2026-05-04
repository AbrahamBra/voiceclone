// POST /api/v2/contradictions-resolve
//   body: { id: <uuid>, action: keep_a|keep_b|both_false_positive|reject_both|punt, note?: string }
//   → { contradiction: {...}, propositions_updated: [<id>...] }
//
// Side effects par action :
//   keep_a : prop B → status='rejected'; insert proposition_merge_history avec
//            merge_source='user_arbitrage_keep_a', kept_proposition_id=A,
//            merged_proposition_text=B.text snapshot ; contradiction →
//            status='resolved', resolved_action, resolved_at=now()
//   keep_b : symétrique sur A.
//   both_false_positive : aucune mutation prop ; contradiction → resolved.
//                          (V1.1 : feed signal au classifieur.)
//   reject_both : props A et B → status='rejected' (1 query) ; contradiction
//                  → resolved. Pas de merge_history.
//   punt : aucune mutation ; contradiction → status='punted', resolved_action
//          stays NULL, resolved_at stays NULL (CHECK invariant migration 071).
//
// Auth : authenticateRequest + hasPersonaAccess (persona_id de la contradiction).

export const maxDuration = 10;

import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../lib/supabase.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["keep_a", "keep_b", "both_false_positive", "reject_both", "punt"]);

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
  const id = (body.id || "").trim();
  const action = body.action;
  const note = typeof body.note === "string" ? body.note : null;

  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "id must be a valid UUID" });
    return;
  }
  if (!ACTIONS.has(action)) {
    res.status(400).json({ error: `action must be one of ${[...ACTIONS].join(", ")}` });
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

  // Fetch contradiction
  const { data: contra, error: cErr } = await supabase
    .from("proposition_contradiction")
    .select("id, persona_id, proposition_a_id, proposition_b_id, kind, status")
    .eq("id", id)
    .single();
  if (cErr || !contra) {
    res.status(404).json({ error: "contradiction not found" });
    return;
  }

  // Already-resolved/punted contradictions are immutable in V1
  if (contra.status !== "open") {
    res.status(409).json({ error: `contradiction is ${contra.status}, cannot re-resolve` });
    return;
  }

  // Auth check on persona
  if (!isAdmin && !(await hasPersonaAccess(client?.id, contra.persona_id))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const propAId = contra.proposition_a_id;
  const propBId = contra.proposition_b_id;
  const propsUpdated = [];

  // ── Action-specific side effects ──
  if (action === "keep_a" || action === "keep_b") {
    const keptId = action === "keep_a" ? propAId : propBId;
    const rejectedId = action === "keep_a" ? propBId : propAId;

    // Fetch the rejected prop for merge_history snapshot
    const { data: rejectedProp, error: pErr } = await supabase
      .from("proposition")
      .select("id, proposed_text, count, source_refs, provenance")
      .eq("id", rejectedId)
      .single();
    if (pErr || !rejectedProp) {
      res.status(500).json({ error: "rejected proposition not found" });
      return;
    }

    // Mark rejected prop
    const { error: updErr } = await supabase
      .from("proposition")
      .update({ status: "rejected", resolved_at: new Date().toISOString() })
      .eq("id", rejectedId);
    if (updErr) {
      res.status(500).json({ error: "proposition update failed" });
      return;
    }
    propsUpdated.push(rejectedId);

    // Insert merge_history snapshot
    const { error: mhErr } = await supabase
      .from("proposition_merge_history")
      .insert({
        persona_id: contra.persona_id,
        kept_proposition_id: keptId,
        merged_proposition_text: rejectedProp.proposed_text,
        merged_proposition_count: rejectedProp.count || 1,
        merged_provenance: rejectedProp.provenance || null,
        merged_source_refs: rejectedProp.source_refs || [],
        merge_source: action === "keep_a" ? "user_arbitrage_keep_a" : "user_arbitrage_keep_b",
        merge_cosine: null,  // user arbitrage, pas auto_synonym
      });
    if (mhErr) {
      // Best-effort : log mais continue. La prop est déjà rejetée, on ne
      // veut pas re-rouvrir ; le merge_history sert pour split-back V1.1.
      console.error("[contradictions-resolve] merge_history insert failed:", mhErr);
    }
  }

  if (action === "reject_both") {
    const { error: updErr } = await supabase
      .from("proposition")
      .update({ status: "rejected", resolved_at: new Date().toISOString() })
      .in("id", [propAId, propBId]);
    if (updErr) {
      res.status(500).json({ error: "proposition update failed" });
      return;
    }
    propsUpdated.push(propAId, propBId);
  }

  // ── Update contradiction itself ──
  const isPunt = action === "punt";
  const updateValues = isPunt
    ? { status: "punted", resolved_action: null, resolved_at: null, resolved_note: note }
    : {
        status: "resolved",
        resolved_action: action === "punt" ? null : action,
        resolved_at: new Date().toISOString(),
        resolved_note: note,
      };

  const { data: updated, error: cUpdErr } = await supabase
    .from("proposition_contradiction")
    .update(updateValues)
    .eq("id", id)
    .select("*");
  if (cUpdErr) {
    res.status(500).json({ error: "contradiction update failed" });
    return;
  }

  res.status(200).json({
    contradiction: (updated && updated[0]) || { id, ...updateValues },
    propositions_updated: propsUpdated,
  });
}

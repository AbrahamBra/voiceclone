// GET /api/v2/setter-activity?persona=<uuid>&period=week|month
//   → { persona_id, period, since, total_corrections, propositions_generated,
//       propositions_accepted, by_setter: [{ client_id, name, corrections, last_activity }] }
//
// Aggregate setter corrections sur la période (default 'week' = 7 derniers jours).
// Pour le strip noir du cockpit V2 + lien drill-down vers /persona/[id]/team.
//
// Source data : feedback_events filtré sur event_type IN ('corrected', 'validated_edited'),
// joined via conversations.client_id → clients.name pour attribuer le setter.
//
// propositions_generated = count(proposition WHERE source='feedback_event'
//   AND source_ref IN <feedback_event ids of this period>).
// propositions_accepted = même filtre + status='accepted'.

export const maxDuration = 10;

import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../lib/supabase.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_PERIODS = new Set(["week", "month"]);
const PERIOD_DAYS = { week: 7, month: 30 };

const CORRECTION_TYPES = ["corrected", "validated_edited"];

export default async function handler(req, res, deps) {
  const {
    authenticateRequest = _authenticateRequest,
    hasPersonaAccess = _hasPersonaAccess,
    supabase = _supabase,
    setCors = _setCors,
    nowIso = () => new Date().toISOString(),
  } = deps || {};

  setCors(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const personaId = (req.query?.persona || "").trim();
  const period = req.query?.period || "week";

  if (!UUID_RE.test(personaId)) {
    res.status(400).json({ error: "persona must be a valid UUID" });
    return;
  }
  if (!VALID_PERIODS.has(period)) {
    res.status(400).json({ error: `period must be one of ${[...VALID_PERIODS].join(", ")}` });
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

  // Compute period boundary
  const sinceDate = new Date(nowIso());
  sinceDate.setUTCDate(sinceDate.getUTCDate() - PERIOD_DAYS[period]);
  const since = sinceDate.toISOString();

  // 1. Fetch feedback_events for this persona in the period (correction types only)
  const fbRes = await supabase
    .from("feedback_events")
    .select("id, conversation_id, event_type, created_at")
    .eq("persona_id", personaId)
    .in("event_type", CORRECTION_TYPES)
    .gte("created_at", since);

  if (fbRes.error) {
    res.status(500).json({ error: "feedback_events query failed", detail: fbRes.error.message });
    return;
  }
  const events = fbRes.data || [];
  const eventIds = events.map(e => e.id);

  // 2. Fetch conversations to map conversation_id → client_id
  const convIds = [...new Set(events.map(e => e.conversation_id))];
  let conversations = [];
  if (convIds.length > 0) {
    const cRes = await supabase
      .from("conversations")
      .select("id, client_id")
      .in("id", convIds);
    if (cRes.error) {
      res.status(500).json({ error: "conversations query failed" });
      return;
    }
    conversations = cRes.data || [];
  }
  const convToClient = Object.fromEntries(conversations.map(c => [c.id, c.client_id]));

  // 3. Fetch client names
  const clientIds = [...new Set(conversations.map(c => c.client_id).filter(Boolean))];
  let clients = [];
  if (clientIds.length > 0) {
    const clRes = await supabase
      .from("clients")
      .select("id, name")
      .in("id", clientIds);
    if (clRes.error) {
      res.status(500).json({ error: "clients query failed" });
      return;
    }
    clients = clRes.data || [];
  }
  const clientNameById = Object.fromEntries(clients.map(c => [c.id, c.name]));

  // 4. Aggregate by setter (client_id)
  const bySetterMap = {};
  for (const e of events) {
    const cid = convToClient[e.conversation_id];
    if (!cid) continue;
    if (!bySetterMap[cid]) {
      bySetterMap[cid] = {
        client_id: cid,
        name: clientNameById[cid] || `Setter #${cid.slice(0, 6)}`,
        corrections: 0,
        last_activity: null,
      };
    }
    bySetterMap[cid].corrections++;
    if (!bySetterMap[cid].last_activity || e.created_at > bySetterMap[cid].last_activity) {
      bySetterMap[cid].last_activity = e.created_at;
    }
  }
  const by_setter = Object.values(bySetterMap).sort((a, b) => b.corrections - a.corrections);

  // 5. Fetch propositions generated from these feedback events
  let propositions_generated = 0;
  let propositions_accepted = 0;
  if (eventIds.length > 0) {
    const pRes = await supabase
      .from("proposition")
      .select("id, status, source_ref")
      .eq("source", "feedback_event")
      .in("source_ref", eventIds);
    if (pRes.error) {
      res.status(500).json({ error: "proposition query failed" });
      return;
    }
    const props = pRes.data || [];
    propositions_generated = props.length;
    propositions_accepted = props.filter(p => p.status === "accepted").length;
  }

  res.status(200).json({
    persona_id: personaId,
    period,
    since,
    total_corrections: events.length,
    propositions_generated,
    propositions_accepted,
    by_setter,
  });
}

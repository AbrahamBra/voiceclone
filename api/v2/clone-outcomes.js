// GET /api/v2/clone-outcomes?persona=<uuid>&period=week
//   → { persona_id, period, rdv_count, rdv_delta }
//
// rdv_count = count(feedback_events.event_type='appointment_booked' AND created_at >= since)
// rdv_delta = current_period_count - previous_period_count

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

  const days = PERIOD_DAYS[period];
  const now = new Date(nowIso());
  const currentSince = new Date(now);
  currentSince.setUTCDate(currentSince.getUTCDate() - days);
  const previousSince = new Date(now);
  previousSince.setUTCDate(previousSince.getUTCDate() - days * 2);

  // Fetch all appointment_booked events in the last 2 periods (current + previous)
  const fbRes = await supabase
    .from("feedback_events")
    .select("id, created_at")
    .eq("persona_id", personaId)
    .eq("event_type", "appointment_booked")
    .gte("created_at", previousSince.toISOString());

  if (fbRes.error) {
    res.status(500).json({ error: "feedback_events query failed", detail: fbRes.error.message });
    return;
  }

  const events = fbRes.data || [];
  const currentSinceIso = currentSince.toISOString();
  const currentCount = events.filter(e => e.created_at >= currentSinceIso).length;
  const previousCount = events.length - currentCount;

  res.status(200).json({
    persona_id: personaId,
    period,
    rdv_count: currentCount,
    rdv_delta: currentCount - previousCount,
  });
}

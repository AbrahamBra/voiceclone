// GET /api/v2/clone-trajectory?persona=<uuid>&weeks=8
//   → { persona_id, period, correction_rate: { current_value, delta, series },
//       autonomy_pct: { current_value, delta, series } }
//
// 8-week trailing series :
//   correction_rate[i] = count(feedback_events where event_type='corrected' AND week=i)
//   autonomy_pct[i] = (assistant_messages_in_week - corrections_in_week) / assistant_messages_in_week
//                     (=1 if no messages drafted that week — edge case)

export const maxDuration = 10;

import {
  authenticateRequest as _authenticateRequest,
  hasPersonaAccess as _hasPersonaAccess,
  supabase as _supabase,
  setCors as _setCors,
} from "../../lib/supabase.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_WEEKS = 8;

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
  const weeks = Number(req.query?.weeks) || DEFAULT_WEEKS;

  if (!UUID_RE.test(personaId)) {
    res.status(400).json({ error: "persona must be a valid UUID" });
    return;
  }
  if (weeks < 1 || weeks > 26) {
    res.status(400).json({ error: "weeks must be between 1 and 26" });
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

  const now = new Date(nowIso());
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - weeks * 7);
  const sinceIso = since.toISOString();

  // 1. Fetch corrections in the window
  const fbRes = await supabase
    .from("feedback_events")
    .select("id, created_at")
    .eq("persona_id", personaId)
    .eq("event_type", "corrected")
    .gte("created_at", sinceIso);
  if (fbRes.error) {
    res.status(500).json({ error: "feedback_events query failed" });
    return;
  }

  // 2. Fetch conversations for this persona to scope messages
  const convRes = await supabase
    .from("conversations")
    .select("id")
    .eq("persona_id", personaId);
  if (convRes.error) {
    res.status(500).json({ error: "conversations query failed" });
    return;
  }
  const convIds = (convRes.data || []).map(c => c.id);

  // 3. Fetch assistant messages in window for these conversations
  let messages = [];
  if (convIds.length > 0) {
    const mRes = await supabase
      .from("messages")
      .select("id, created_at")
      .in("conversation_id", convIds)
      .eq("role", "assistant")
      .gte("created_at", sinceIso);
    if (mRes.error) {
      res.status(500).json({ error: "messages query failed" });
      return;
    }
    messages = mRes.data || [];
  }

  // 4. Bucket by week (week 0 = oldest, week N-1 = current)
  function weekIndex(iso) {
    const d = new Date(iso);
    const diffMs = now.getTime() - d.getTime();
    const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
    const idx = weeks - 1 - diffWeeks;
    return (idx >= 0 && idx < weeks) ? idx : null;
  }

  const correctionsByWeek = Array(weeks).fill(0);
  for (const e of (fbRes.data || [])) {
    const idx = weekIndex(e.created_at);
    if (idx !== null) correctionsByWeek[idx]++;
  }

  const messagesByWeek = Array(weeks).fill(0);
  for (const m of messages) {
    const idx = weekIndex(m.created_at);
    if (idx !== null) messagesByWeek[idx]++;
  }

  const autonomyByWeek = correctionsByWeek.map((c, i) => {
    const m = messagesByWeek[i];
    if (m === 0) return 1;  // no messages → consider full autonomy (edge case)
    return Math.round(((m - c) / m) * 100) / 100;
  });

  res.status(200).json({
    persona_id: personaId,
    period: `${weeks}weeks`,
    correction_rate: {
      current_value: correctionsByWeek[weeks - 1],
      delta: correctionsByWeek[weeks - 1] - correctionsByWeek[0],
      series: correctionsByWeek,
    },
    autonomy_pct: {
      current_value: autonomyByWeek[weeks - 1],
      delta: Math.round((autonomyByWeek[weeks - 1] - autonomyByWeek[0]) * 100) / 100,
      series: autonomyByWeek,
    },
  });
}

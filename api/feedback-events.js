import { authenticateRequest, supabase, setCors, hasPersonaAccess } from "../lib/supabase.js";

const VALID_TYPES = new Set(["validated", "validated_edited", "corrected", "saved_rule", "excellent", "client_validated", "paste_zone_dismissed"]);

// Maps a feedback_events.event_type to a learning_events.event_type. Keeps
// existing taxonomy (rule_added / correction_saved) where it already matches,
// introduces positive_reinforcement for UI validations and signal_dismissed
// for paste-zone dismiss. Intensity carried in payload, not in type, to keep
// learning_events grep-able by category.
const FB_TO_LEARNING = {
  validated:            { type: "positive_reinforcement", intensity: "low" },
  validated_edited:     { type: "positive_reinforcement", intensity: "edited" },
  excellent:            { type: "positive_reinforcement", intensity: "high" },
  client_validated:     { type: "positive_reinforcement", intensity: "client" },
  corrected:            { type: "correction_saved",       intensity: null },
  saved_rule:           { type: "rule_added",             intensity: null },
  paste_zone_dismissed: { type: "signal_dismissed",       intensity: null },
};

export default async function handler(req, res) {
  setCors(res, "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (!["GET", "POST"].includes(req.method)) {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Validate query param for GET before auth (cheaper error path)
  if (req.method === "GET" && !req.query?.conversation) {
    res.status(400).json({ error: "conversation query param required" });
    return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  if (req.method === "GET") {
    const conversationId = req.query.conversation;
    const limit = Math.min(parseInt(req.query?.limit, 10) || 100, 500);

    const { data: conv, error: convErr } = await supabase
      .from("conversations").select("id, persona_id, client_id").eq("id", conversationId).single();
    if (convErr || !conv) { res.status(404).json({ error: "Conversation not found" }); return; }

    if (!isAdmin) {
      if (!(await hasPersonaAccess(client?.id, conv.persona_id))) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }

    const { data, error } = await supabase
      .from("feedback_events")
      .select("id, message_id, event_type, correction_text, diff_before, diff_after, rules_fired, learning_event_id, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      res.status(500).json({ error: "Failed to fetch feedback events" });
      return;
    }
    res.json({ events: data || [] });
    return;
  }

  // POST
  const body = req.body || {};
  const { conversation_id, message_id, event_type, correction_text, diff_before, diff_after, rules_fired } = body;

  if (!conversation_id || !message_id || !event_type) {
    res.status(400).json({ error: "conversation_id, message_id, event_type required" });
    return;
  }
  if (!VALID_TYPES.has(event_type)) {
    res.status(400).json({ error: `invalid event_type; must be one of ${[...VALID_TYPES].join(",")}` });
    return;
  }

  const { data: conv, error: convErr } = await supabase
    .from("conversations").select("id, persona_id, client_id").eq("id", conversation_id).single();
  if (convErr || !conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  if (!isAdmin) {
    if (!(await hasPersonaAccess(client?.id, conv.persona_id))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }

  // Emit paired learning_event first so feedback_events row can back-link via
  // learning_event_id. Best-effort: if this fails, feedback still records with
  // null FK (non-blocking for the UI journal).
  let learning_event_id = null;
  const leMap = FB_TO_LEARNING[event_type];
  if (leMap) {
    const lePayload = { source: "feedback_events", fb_event_type: event_type, message_id, conversation_id };
    if (leMap.intensity) lePayload.intensity = leMap.intensity;
    if (Array.isArray(rules_fired) && rules_fired.length) lePayload.rules_fired = rules_fired;
    const { data: leData } = await supabase
      .from("learning_events")
      .insert({ persona_id: conv.persona_id, event_type: leMap.type, payload: lePayload })
      .select("id").single();
    learning_event_id = leData?.id || null;
  }

  const row = {
    conversation_id,
    message_id,
    persona_id: conv.persona_id,
    event_type,
    correction_text: correction_text || null,
    diff_before: diff_before || null,
    diff_after: diff_after || null,
    rules_fired: Array.isArray(rules_fired) ? rules_fired : [],
    learning_event_id,
  };

  const { data, error } = await supabase
    .from("feedback_events").insert(row).select("id, created_at").single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  // Promote validated/excellent messages as gold — alimente `compute-rhythm-baseline.js`
  // (Mahalanobis) et toute consommation downstream de `messages.is_gold`.
  if (event_type === "excellent" || event_type === "client_validated") {
    const { error: goldErr } = await supabase
      .from("messages").update({ is_gold: true }).eq("id", message_id);
    if (goldErr) console.error("[feedback-events] is_gold update failed", goldErr.message);
  }

  res.status(201).json({ id: data.id, created_at: data.created_at });
}

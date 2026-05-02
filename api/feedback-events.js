import { authenticateRequest, supabase, setCors, hasPersonaAccess } from "../lib/supabase.js";
import { resolveFirings } from "../lib/protocol-v2-rule-counters.js";

const VALID_TYPES = new Set([
  "validated", "validated_edited", "corrected", "saved_rule",
  "excellent", "client_validated", "paste_zone_dismissed",
  // Chantier 3.1 — implicit signals. implicit_accept is emitted by api/chat.js
  // on a prior bot message when the user sends a follow-up without correcting.
  // implicit_dismiss is reserved for future beforeunload / abandon detection.
  "implicit_accept", "implicit_dismiss",
  // Chantier 3 (2026-05-02) — feedback canal leak fix : regen_rejection et
  // copy_paste_out étaient émis uniquement vers /api/feedback (corrections
  // table) et asymétriques avec /api/feedback-events. La FeedbackRail UI
  // les manquait, et le drain protocol-v2 ne voyait pas le harmful_count
  // associé. Émis maintenant en parallèle via api/feedback.js sur ces 2
  // types pour fermer le canal.
  "regen_rejection", "copy_paste_out",
]);

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
  implicit_accept:      { type: "positive_reinforcement", intensity: "implicit" },
  implicit_dismiss:     { type: "signal_dismissed",       intensity: "implicit" },
  // Chantier 3 — implicit negative signals. regen_rejection = user clicked ↻
  // (rejected the draft strongly). copy_paste_out = user copied the draft
  // (weak positive at corrections layer, but emitted ALSO as feedback_event
  // for visibility in FeedbackRail UI).
  regen_rejection:      { type: "correction_saved",       intensity: "implicit_negative" },
  copy_paste_out:       { type: "positive_reinforcement", intensity: "implicit_copy" },
};

// Chantier 3.1 — feedback event_type → protocol_rule_firing outcome resolution.
// Pure mapping: helpful = the rules likely contributed; harmful = they likely
// didn't (user corrected); unrelated = signal too noisy to attribute.
// saved_rule is intentionally absent — it's an off-flow action (user saving a
// new rule from scratch), not feedback on the artifact set that fired.
const EVENT_TO_FIRING_OUTCOME = {
  validated:            "helpful",
  validated_edited:     "helpful",
  excellent:            "helpful",
  client_validated:     "helpful",
  implicit_accept:      "helpful",
  copy_paste_out:       "helpful",  // user copied the draft → artifacts contributed positively
  corrected:            "harmful",
  regen_rejection:      "harmful",  // user clicked regen → artifacts likely missed the mark
  paste_zone_dismissed: "unrelated",
  implicit_dismiss:     "unrelated",
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

  // Scope check: ensure message_id belongs to conversation_id. Without this,
  // a user with access to one conversation could attach a feedback (and flip
  // is_gold below) on a message from another conversation by spoofing
  // message_id in the payload.
  const { data: msg } = await supabase
    .from("messages").select("conversation_id").eq("id", message_id).single();
  if (!msg || msg.conversation_id !== conversation_id) {
    res.status(403).json({ error: "message_id does not belong to this conversation" });
    return;
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

  // Chantier 3.1 — resolve the protocol_rule_firing rows that were inserted
  // pending when this assistant message was generated (Chantier 2bis #137).
  // Best-effort: never fail the feedback insert if the resolution path errors.
  const firingOutcome = EVENT_TO_FIRING_OUTCOME[event_type];
  if (firingOutcome) {
    resolveFirings({ supabase, messageId: message_id, outcome: firingOutcome })
      .catch((err) => console.error("[feedback-events] resolveFirings failed", err?.message));
  }

  res.status(201).json({ id: data.id, created_at: data.created_at });
}

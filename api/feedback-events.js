import { authenticateRequest, supabase, setCors, hasPersonaAccess } from "../lib/supabase.js";

const VALID_TYPES = new Set(["validated", "validated_edited", "corrected", "saved_rule", "client_validated"]);

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

  const row = {
    conversation_id,
    message_id,
    persona_id: conv.persona_id,
    event_type,
    correction_text: correction_text || null,
    diff_before: diff_before || null,
    diff_after: diff_after || null,
    rules_fired: Array.isArray(rules_fired) ? rules_fired : [],
  };

  const { data, error } = await supabase
    .from("feedback_events").insert(row).select("id, created_at").single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json({ id: data.id, created_at: data.created_at });
}

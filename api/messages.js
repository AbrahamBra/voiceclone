import { authenticateRequest, supabase, setCors, hasPersonaAccess } from "../lib/supabase.js";

const VALID_TURN_KINDS = new Set([
  "prospect", "clone_draft", "toi", "draft_rejected", "legacy", "meta",
]);

export default async function handler(req, res) {
  setCors(res, "PATCH, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (!["PATCH", "POST"].includes(req.method)) {
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

  // ── POST: insert a prospect/toi message without triggering the LLM ──
  // Used by ChatComposer's "📥 ajouter prospect" button.
  if (req.method === "POST") {
    const { conversation_id, role, content, turn_kind } = req.body || {};
    if (!conversation_id || !role || !content) {
      res.status(400).json({ error: "conversation_id, role, content required" });
      return;
    }
    if (!["user", "assistant"].includes(role)) {
      res.status(400).json({ error: "role must be user or assistant" });
      return;
    }
    if (turn_kind !== undefined && !VALID_TURN_KINDS.has(turn_kind)) {
      res.status(400).json({ error: "invalid turn_kind" });
      return;
    }

    const { data: conv, error: convErr } = await supabase
      .from("conversations").select("id, persona_id, client_id").eq("id", conversation_id).single();
    if (convErr || !conv) { res.status(404).json({ error: "Conversation not found" }); return; }
    if (!isAdmin && conv.client_id !== client.id) {
      res.status(403).json({ error: "Forbidden" }); return;
    }

    const row = { conversation_id, role, content, turn_kind: turn_kind || "legacy" };

    const { data, error } = await supabase
      .from("messages").insert(row).select("id, role, turn_kind, content, created_at").single();
    if (error) { res.status(500).json({ error: error.message }); return; }

    // Bump conversation's last_message_at so the sidebar sorts correctly
    await supabase.from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversation_id);

    res.status(201).json(data);
    return;
  }

  // ── PATCH: update an existing message (turn_kind, content, etc.) ──
  const { id } = req.query || {};
  if (!id) { res.status(400).json({ error: "id query param required" }); return; }

  const { turn_kind, content, edited_before_send, draft_original } = req.body || {};

  if (turn_kind !== undefined && !VALID_TURN_KINDS.has(turn_kind)) {
    res.status(400).json({ error: "invalid turn_kind" });
    return;
  }

  const { data: msg, error: msgErr } = await supabase
    .from("messages").select("id, conversation_id").eq("id", id).single();
  if (msgErr || !msg) { res.status(404).json({ error: "Message not found" }); return; }

  const { data: conv, error: convErr } = await supabase
    .from("conversations").select("id, persona_id, client_id").eq("id", msg.conversation_id).single();
  if (convErr || !conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  if (!isAdmin) {
    if (!(await hasPersonaAccess(client?.id, conv.persona_id))) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
  }

  const patch = {};
  if (turn_kind !== undefined) patch.turn_kind = turn_kind;
  if (typeof content === "string") patch.content = content;
  if (typeof edited_before_send === "boolean") patch.edited_before_send = edited_before_send;
  if (typeof draft_original === "string") patch.draft_original = draft_original;

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "no updatable fields" }); return;
  }

  const { error } = await supabase.from("messages").update(patch).eq("id", id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true, patch });
}

import { authenticateRequest, supabase, setCors } from "../lib/supabase.js";

export default async function handler(req, res) {
  setCors(res, "GET, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  // --- PATCH: update conversation (title or dossier fields) ---
  if (req.method === "PATCH") {
    const { id } = req.query || {};
    const { title, prospect_name, stage, note } = req.body || {};

    if (!id) { res.status(400).json({ error: "id query param required" }); return; }

    // Build partial update — only fields actually provided are patched
    const patch = {};
    if (typeof title === "string") {
      if (!title.trim()) { res.status(400).json({ error: "title empty" }); return; }
      patch.title = title.trim().slice(0, 100);
    }
    if (typeof prospect_name === "string") patch.prospect_name = prospect_name.trim().slice(0, 120) || null;
    if (typeof stage === "string")         patch.stage = stage.trim().slice(0, 60) || null;
    if (typeof note === "string")          patch.note = note.trim().slice(0, 300) || null;

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "no updatable fields provided" });
      return;
    }

    const { data: conv, error: convErr } = await supabase
      .from("conversations").select("id, client_id").eq("id", id).single();
    if (convErr || !conv) { res.status(404).json({ error: "Not found" }); return; }
    if (!isAdmin && conv.client_id !== client.id) { res.status(403).json({ error: "Forbidden" }); return; }

    const { error: updateErr } = await supabase
      .from("conversations").update(patch).eq("id", id);
    if (updateErr) { res.status(500).json({ error: updateErr.message }); return; }

    res.json({ ok: true, patch });
    return;
  }

  // --- DELETE: remove conversation + its messages ---
  if (req.method === "DELETE") {
    const { id } = req.query || {};
    if (!id) { res.status(400).json({ error: "id query param required" }); return; }

    const { data: conv, error: convErr } = await supabase
      .from("conversations").select("id, client_id").eq("id", id).single();
    if (convErr || !conv) { res.status(404).json({ error: "Not found" }); return; }
    if (!isAdmin && conv.client_id !== client.id) { res.status(403).json({ error: "Forbidden" }); return; }

    // Delete messages first (FK), then conversation
    const { error: msgDelErr } = await supabase.from("messages").delete().eq("conversation_id", id);
    if (msgDelErr) { res.status(500).json({ error: msgDelErr.message }); return; }
    const { error: delErr } = await supabase.from("conversations").delete().eq("id", id);
    if (delErr) { res.status(500).json({ error: delErr.message }); return; }

    res.json({ ok: true });
    return;
  }

  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  const { id, search, persona, before, include_meta } = req.query || {};
  // include_meta=true opts in to system confirmations (rule added/weakened)
  // for the "journal d'apprentissage" pane. Default is chat-only so the
  // main DM thread stays WYSIWYG (what you see = what you copy to LinkedIn).
  const includeMeta = include_meta === "true" || include_meta === "1";

  // --- 1. Load single conversation + messages ---
  if (id) {
    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", id)
      .single();

    if (convErr || !conv) { res.status(404).json({ error: "Conversation not found" }); return; }

    if (!isAdmin && conv.client_id !== client.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    let msgQuery = supabase
      .from("messages")
      .select("id, role, content, created_at, message_type")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(50);

    if (!includeMeta) {
      msgQuery = msgQuery.eq("message_type", "chat");
    }

    if (before) {
      msgQuery = msgQuery.lt("created_at", before);
    }

    const { data: messages, error: msgErr } = await msgQuery;
    if (msgErr) { res.status(500).json({ error: msgErr.message }); return; }

    res.json({ conversation: conv, messages: messages || [] });
    return;
  }

  // --- 2. Search messages ---
  // Search targets the DM simulation content only — meta shortcut
  // confirmations are noise for the user looking for a past draft.
  if (search && persona) {
    let query = supabase
      .from("messages")
      .select("id, conversation_id, content, created_at, conversations!inner(title, client_id, persona_id)")
      .eq("conversations.persona_id", persona)
      .eq("message_type", "chat")
      .ilike("content", `%${search}%`)
      .order("created_at", { ascending: false })
      .limit(20);

    const { data, error } = await query;
    if (error) { res.status(500).json({ error: error.message }); return; }

    const rows = (data || []).filter(m =>
      isAdmin || m.conversations.client_id === client.id
    );

    const results = rows.map(m => ({
      conversation_id: m.conversation_id,
      conversation_title: m.conversations.title,
      message_content_snippet: m.content.slice(0, 200),
      created_at: m.created_at,
    }));

    res.json({ results });
    return;
  }

  // --- 3. List conversations for a persona ---
  if (persona) {
    let listQuery = supabase
      .from("conversations")
      .select("id, persona_id, scenario, title, last_message_at, created_at")
      .eq("persona_id", persona)
      .order("last_message_at", { ascending: false })
      .limit(50);

    if (!isAdmin) {
      listQuery = listQuery.eq("client_id", client.id);
    }

    const { data: convs, error: listErr } = await listQuery;
    if (listErr) { res.status(500).json({ error: listErr.message }); return; }

    const conversations = convs || [];

    // Attach message counts via RPC
    let messageCounts = {};
    if (conversations.length > 0) {
      const convIds = conversations.map(c => c.id);
      const { data: counts } = await supabase.rpc("count_messages_by_conversation", { conv_ids: convIds });
      if (counts) {
        for (const row of counts) {
          messageCounts[row.conversation_id] = row.count;
        }
      }
    }

    const result = conversations.map(c => ({
      ...c,
      message_count: messageCounts[c.id] ?? 0,
    }));

    res.json({ conversations: result });
    return;
  }

  res.status(400).json({ error: "Provide id, search+persona, or persona query param" });
}

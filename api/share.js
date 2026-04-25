import { parse } from "url";
import { authenticateRequest, supabase, setCors } from "../lib/supabase.js";

export default async function handler(req, res) {
  setCors(res, "GET, POST, PUT, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (!["GET", "POST", "PUT"].includes(req.method)) {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  let client, isAdmin;
  try {
    ({ client, isAdmin } = await authenticateRequest(req));
  } catch (err) {
    res.status(err.status || 403).json({ error: err.error || "Auth failed" });
    return;
  }

  const { query } = parse(req.url, true);

  // ── POST: Generate share token (owner only) ──
  if (req.method === "POST") {
    const personaId = req.body?.persona_id;
    if (!personaId) { res.status(400).json({ error: "persona_id required" }); return; }

    // Check ownership
    const { data: persona } = await supabase
      .from("personas").select("client_id, name").eq("id", personaId).single();
    if (!persona) { res.status(404).json({ error: "Persona not found" }); return; }
    if (!isAdmin && persona.client_id !== client?.id) {
      res.status(403).json({ error: "Only the owner can share" }); return;
    }

    const { data: token, error } = await supabase
      .from("share_tokens")
      .insert({ persona_id: personaId, created_by: client?.id || persona.client_id })
      .select("token, expires_at")
      .single();

    if (error) { res.status(500).json({ error: "Failed to create share token" }); return; }

    res.json({ token: token.token, expires_at: token.expires_at });
    return;
  }

  // ── GET: Preview share (any authenticated user) ──
  if (req.method === "GET") {
    const token = query.token;
    if (!token) { res.status(400).json({ error: "token required" }); return; }

    const { data: st, error: selErr } = await supabase
      .from("share_tokens")
      .select("persona_id, expires_at, personas(name, title, avatar), creator:clients!share_tokens_created_by_fkey(name)")
      .eq("token", token)
      .single();

    if (selErr) {
      console.log(JSON.stringify({ event: "share_get_db_error", token_prefix: token?.slice(0, 8), error: selErr.message, code: selErr.code }));
      // PGRST200 family = relationship/FK hint not resolved → distinct error so the UI can surface it
      if (selErr.code === "PGRST200" || /relationship|fkey/i.test(selErr.message || "")) {
        res.status(500).json({ error: "Configuration share incorrecte" }); return;
      }
    }
    if (!st) { res.status(404).json({ error: "Token invalide" }); return; }
    if (new Date(st.expires_at) < new Date()) {
      res.status(410).json({ error: "Lien expire" }); return;
    }

    // Check if already shared with this user
    let alreadyShared = false;
    if (client) {
      const { data: existing } = await supabase
        .from("persona_shares")
        .select("id")
        .eq("persona_id", st.persona_id).eq("client_id", client.id)
        .single();
      alreadyShared = !!existing;
    }

    res.json({
      persona: st.personas,
      persona_id: st.persona_id,
      shared_by_name: st.creator?.name || null,
      already_shared: alreadyShared,
    });
    return;
  }

  // ── PUT: Claim share token ──
  if (req.method === "PUT") {
    const token = query.token;
    if (!token) { res.status(400).json({ error: "token required" }); return; }
    if (!client) { res.status(401).json({ error: "Login required" }); return; }

    const { data: st, error: selErr } = await supabase
      .from("share_tokens")
      .select("persona_id, expires_at, personas(client_id)")
      .eq("token", token)
      .single();

    if (selErr) {
      console.log(JSON.stringify({ event: "share_put_db_error", token_prefix: token?.slice(0, 8), error: selErr.message, code: selErr.code }));
    }
    if (!st) { res.status(404).json({ error: "Token invalide" }); return; }
    if (new Date(st.expires_at) < new Date()) {
      res.status(410).json({ error: "Lien expire" }); return;
    }
    if (st.personas.client_id === client.id) {
      res.status(400).json({ error: "Vous etes deja le proprietaire de ce clone" }); return;
    }

    // Upsert share (idempotent)
    const { error } = await supabase
      .from("persona_shares")
      .upsert(
        { persona_id: st.persona_id, client_id: client.id, share_token: token },
        { onConflict: "persona_id,client_id" }
      );

    if (error) { res.status(500).json({ error: "Failed to claim share" }); return; }

    // Mark token as used
    const { error: markErr } = await supabase.from("share_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("token", token);
    if (markErr) console.log(JSON.stringify({ event: "share_token_mark_error", token_prefix: token?.slice(0, 8), error: markErr.message }));

    res.json({ ok: true, persona_id: st.persona_id });
  }
}
